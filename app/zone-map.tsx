import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { Marker, Polygon, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

interface HubSubLocation {
  location_name: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
}

const isFiniteCoord = (val: any): val is number => typeof val === "number" && Number.isFinite(val);



class MapErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.log("MapView native render error caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export default function ZoneMapScreen() {
  const params = useLocalSearchParams<{
    hubName?: string;
    locationsStr?: string;
    outOfZone?: string;
  }>();

  const mapRef = useRef<MapView | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [assignedHubName, setAssignedHubName] = useState(
    params.hubName && params.hubName !== "Assigned Zone"
      ? params.hubName
      : "Assigned Zone"
  );
  const [assignedLocationsStr, setAssignedLocationsStr] = useState(
    params.locationsStr || ""
  );
  const [assignedHubCoords, setAssignedHubCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [hubSubLocations, setHubSubLocations] = useState<HubSubLocation[]>([]);
  const [currentCoords, setCurrentCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [isOutOfZone, setIsOutOfZone] = useState(
    params.outOfZone === "true"
  );
  const [selectedPincodeInfo, setSelectedPincodeInfo] = useState<string | null>(null);

  useEffect(() => {
    loadZoneData();
  }, []);

  const loadZoneData = async () => {
    setLoading(true);
    setDataError(null);
    setLocationError(null);

    try {
      let email = "";
      let userId = "";

      // 1. Instant User & Session Retrieval
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user) {
        email = sessionData.session.user.email?.toLowerCase().trim() || "";
        userId = sessionData.session.user.id;
      } else {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user?.email) {
          email = userData.user.email.toLowerCase().trim();
          userId = userData.user.id;
        }
      }

      if (!email) {
        setDataError("Unable to fetch assigned zone. Please log in again.");
        return;
      }

      // 2. Fast Live Location Fetch (3s timeout)
      let locCoords: { latitude: number; longitude: number } | null = null;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Promise.race([
            Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
          if (loc?.coords && isFiniteCoord(loc.coords.latitude) && isFiniteCoord(loc.coords.longitude)) {
            locCoords = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            };
            setCurrentCoords(locCoords);
          }
        }
      } catch (locErr) {
        console.log("Location fetch error in zone-map:", locErr);
      }

      // Fallback live_location from staff_profile if GPS timed out
      if (!locCoords && userId) {
        try {
          const { data: profile } = await supabase
            .from("staff_profile")
            .select("live_location")
            .eq("id", userId)
            .maybeSingle();

          if (profile?.live_location && typeof profile.live_location === "string") {
            const parts = profile.live_location.split(",").map((s: string) => parseFloat(s.trim()));
            if (parts.length === 2 && isFiniteCoord(parts[0]) && isFiniteCoord(parts[1])) {
              locCoords = { latitude: parts[0], longitude: parts[1] };
              setCurrentCoords(locCoords);
            }
          }
        } catch (pErr) {}
      }

      if (!locCoords) {
        setLocationError("Failed to fetch your current location.");
      }

      // 3. Dynamic Database Fetch: hub_category_counts
      const { data: hubs, error: hubsError } = await supabase
        .from("hub_category_counts")
        .select("hub, location, assigned_staff");

      // Prioritize row with valid hub name
      const match =
        hubs?.find(
          (item) =>
            item.assigned_staff?.toLowerCase().includes(email) &&
            item.hub &&
            item.hub.trim() !== "" &&
            item.hub.trim().toLowerCase() !== "assigned zone"
        ) ||
        hubs?.find((item) =>
          item.assigned_staff?.toLowerCase().includes(email)
        );

      let resolvedHubName = (match?.hub || params.hubName || "Assigned Zone").trim();
      if (!resolvedHubName || resolvedHubName.toLowerCase() === "assigned zone") {
        if (params.hubName && params.hubName.toLowerCase() !== "assigned zone") {
          resolvedHubName = params.hubName.trim();
        }
      }

      if (
        (!resolvedHubName || resolvedHubName.toLowerCase() === "assigned zone") &&
        (!match || hubsError || !hubs || hubs.length === 0)
      ) {
        setDataError("Unable to fetch assigned zone. Please try again.");
        return;
      }

      setAssignedHubName(resolvedHubName);

      // 4. Dynamic Database Fetch: hub_locations for this assigned hub
      let rawSubLocs: Array<{ location_name: string; pincode: string }> = [];
      let hubPincodes: string[] = [];

      if (resolvedHubName && resolvedHubName.toLowerCase() !== "assigned zone") {
        const { data: hubLocRows } = await supabase
          .from("hub_locations")
          .select("location_name, pincode")
          .eq("hub_name", resolvedHubName);

        if (hubLocRows && hubLocRows.length > 0) {
          rawSubLocs = hubLocRows.map((r) => ({
            location_name: (r.location_name || "").trim(),
            pincode: String(r.pincode || "").trim(),
          }));
          hubPincodes = rawSubLocs.map((r) => r.pincode).filter(Boolean);
        }
      }

      if (rawSubLocs.length > 0) {
        const formatted = rawSubLocs
          .map((s) => (s.pincode ? `${s.location_name} (${s.pincode})` : s.location_name))
          .join(" • ");
        setAssignedLocationsStr(formatted);
      } else if (match?.location) {
        setAssignedLocationsStr(match.location);
      } else if (params.locationsStr) {
        setAssignedLocationsStr(params.locationsStr);
      }

      // 5. Non-blocking Parallel Dynamic Geocoding
      const geocodedSubLocs: HubSubLocation[] = await Promise.all(
        rawSubLocs.map(async (sub) => {
          let lat: number | undefined;
          let lng: number | undefined;
          try {
            const query = `${sub.location_name}, ${sub.pincode || ""}, Telangana, India`;
            const geoResult = await Promise.race([
              Location.geocodeAsync(query),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
            ]);
            if (geoResult && geoResult.length > 0 && isFiniteCoord(geoResult[0].latitude) && isFiniteCoord(geoResult[0].longitude)) {
              lat = geoResult[0].latitude;
              lng = geoResult[0].longitude;
            }
          } catch (e) {}

          return {
            location_name: sub.location_name,
            pincode: sub.pincode,
            latitude: lat,
            longitude: lng,
          };
        })
      );

      // 6. Compute Dynamic Hub Centroid (with fallback dictionary)
      const validCoords = geocodedSubLocs.filter(
        (s) => isFiniteCoord(s.latitude) && isFiniteCoord(s.longitude)
      );

      let hubCentroid: { latitude: number; longitude: number } | null = null;

      if (validCoords.length > 0) {
        const sumLat = validCoords.reduce((acc, curr) => acc + (curr.latitude || 0), 0);
        const sumLng = validCoords.reduce((acc, curr) => acc + (curr.longitude || 0), 0);
        hubCentroid = {
          latitude: sumLat / validCoords.length,
          longitude: sumLng / validCoords.length,
        };
      } else if (resolvedHubName && resolvedHubName.toLowerCase() !== "assigned zone") {
        try {
          const mainHubGeo = await Promise.race([
            Location.geocodeAsync(`${resolvedHubName}, Telangana, India`),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
          ]);
          if (mainHubGeo && mainHubGeo.length > 0 && isFiniteCoord(mainHubGeo[0].latitude) && isFiniteCoord(mainHubGeo[0].longitude)) {
            hubCentroid = {
              latitude: mainHubGeo[0].latitude,
              longitude: mainHubGeo[0].longitude,
            };
          }
        } catch (e) {}
      }

      if (hubCentroid) {
        setAssignedHubCoords(hubCentroid);

        // Fill missing sub-location coordinates relative to hubCentroid to guarantee polygons render
        geocodedSubLocs.forEach((sub, idx) => {
          if (!sub.latitude || !sub.longitude || !isFiniteCoord(sub.latitude) || !isFiniteCoord(sub.longitude)) {
            const angle = (idx * 2 * Math.PI) / Math.max(1, geocodedSubLocs.length);
            sub.latitude = hubCentroid!.latitude + 0.012 * Math.cos(angle);
            sub.longitude = hubCentroid!.longitude + 0.012 * Math.sin(angle);
          }
        });
      }

      setHubSubLocations(geocodedSubLocs);

      // 7. Dynamic Out-of-Zone Boundary Check (Full 4-Tier Check Aligned with my-role.tsx)
      let liveInside = false;

      // Tier 1: Hub Center Proximity Check (4.5 km)
      if (locCoords && hubCentroid) {
        const distToHub = getDistanceFromLatLonInKm(
          locCoords.latitude,
          locCoords.longitude,
          hubCentroid.latitude,
          hubCentroid.longitude
        );
        if (distToHub <= 4.5) {
          liveInside = true;
        }
      }

      // Tier 2: Sub-Location Proximity Check (3.5 km to ANY assigned sub-location)
      if (!liveInside && locCoords && geocodedSubLocs.length > 0) {
        for (const sub of geocodedSubLocs) {
          if (isFiniteCoord(sub.latitude) && isFiniteCoord(sub.longitude)) {
            const d = getDistanceFromLatLonInKm(
              locCoords.latitude,
              locCoords.longitude,
              sub.latitude,
              sub.longitude
            );
            if (d <= 3.5) {
              liveInside = true;
              break;
            }
          }
        }
      }

      // Tier 3 & 4: Reverse Geocode Postal Code & Keyword Match
      if (!liveInside && locCoords) {
        try {
          const reversed = await Promise.race([
            Location.reverseGeocodeAsync({
              latitude: locCoords.latitude,
              longitude: locCoords.longitude,
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
          ]);

          if (reversed && reversed.length > 0) {
            const place = reversed[0];
            const postalCode = String(place.postalCode || "").trim();
            const namePart = (place.name || place.street || "").trim();
            const subregionPart = (place.subregion || place.district || place.city || "").trim();

            // Tier 3: Exact Assigned Pincode Match
            if (postalCode) {
              const allPincodes = [
                ...hubPincodes,
                ...rawSubLocs.map((s) => s.pincode).filter(Boolean),
                ...((match?.location || "").match(/\b\d{6}\b/g) || []),
                ...((params.locationsStr || "").match(/\b\d{6}\b/g) || []),
              ];

              if (allPincodes.some((pin) => pin && postalCode.includes(pin.trim()))) {
                liveInside = true;
              }
            }

            // Tier 4: Assigned Location Keyword Match
            if (!liveInside) {
              const activeLocStr = match?.location || params.locationsStr || "";
              if (activeLocStr) {
                const keywords = activeLocStr
                  .toLowerCase()
                  .split(/[•,\n()]+/)
                  .map((item: string) => item.trim())
                  .filter((item: string) => item.length > 2 && !/^\d+$/.test(item));

                const currentWords = `${namePart} ${subregionPart}`.toLowerCase();
                const nameMatch = keywords.some(
                  (kw: string) => kw && currentWords.includes(kw)
                );

                if (nameMatch) {
                  liveInside = true;
                }
              }
            }
          }
        } catch (e) {
          console.log("Reverse geocode in zone-map error:", e);
        }
      }

      // Safety Gate: If no valid hub coordinates/sub-locations could be resolved, preserve incoming param state
      if (geocodedSubLocs.length === 0 && !hubCentroid) {
        liveInside = params.outOfZone === "false";
      }

      setIsOutOfZone(!liveInside);

      if (userId) {
        await supabase
          .from("staff_profile")
          .update({ is_out_of_zone: !liveInside })
          .eq("id", userId);
      }
    } catch (err) {
      console.log("Error loading zone data:", err);
      setDataError("Unable to fetch assigned zone. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCheckYourZone = () => {
    if (mapRef.current && assignedHubCoords && isFiniteCoord(assignedHubCoords.latitude) && isFiniteCoord(assignedHubCoords.longitude)) {
      mapRef.current.animateToRegion(
        {
          latitude: assignedHubCoords.latitude,
          longitude: assignedHubCoords.longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        },
        1000
      );
    }
  };

  const generatePincodeBoundaryPoints = (lat: number, lng: number, radiusKm: number = 1.3) => {
    if (!isFiniteCoord(lat) || !isFiniteCoord(lng)) return [];
    const cosLat = Math.cos((lat * Math.PI) / 180);
    if (Math.abs(cosLat) < 0.0001) return [];

    const points: Array<{ latitude: number; longitude: number }> = [];
    const numPoints = 12;
    const seed = (Math.abs(lat * 1000) + Math.abs(lng * 1000)) % 10;
    for (let i = 0; i < numPoints; i++) {
      const angle = (i * 2 * Math.PI) / numPoints;
      const varRadius = radiusKm * (0.85 + 0.3 * Math.sin(angle * 3 + seed));
      const latOffset = (varRadius / 111) * Math.cos(angle);
      const lngOffset = (varRadius / (111 * cosLat)) * Math.sin(angle);
      const ptLat = lat + latOffset;
      const ptLng = lng + lngOffset;
      if (isFiniteCoord(ptLat) && isFiniteCoord(ptLng)) {
        points.push({
          latitude: ptLat,
          longitude: ptLng,
        });
      }
    }
    return points;
  };

  const getConvexHullCoordinates = (points: Array<{ latitude: number; longitude: number }>) => {
    if (!points || points.length < 3) return [];
    const validPoints = points.filter(
      (p) => p && isFiniteCoord(p.latitude) && isFiniteCoord(p.longitude)
    );
    if (validPoints.length < 3) return [];

    const sorted = [...validPoints].sort((a, b) =>
      a.longitude === b.longitude ? a.latitude - b.latitude : a.longitude - b.longitude
    );

    const cross = (o: any, a: any, b: any) =>
      (a.longitude - o.longitude) * (b.latitude - o.latitude) -
      (a.latitude - o.latitude) * (b.longitude - o.longitude);

    const lower: any[] = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }

    const upper: any[] = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
  };

  const mapLat = (currentCoords && isFiniteCoord(currentCoords.latitude))
    ? currentCoords.latitude
    : (assignedHubCoords && isFiniteCoord(assignedHubCoords.latitude))
    ? assignedHubCoords.latitude
    : 17.4851;

  const mapLng = (currentCoords && isFiniteCoord(currentCoords.longitude))
    ? currentCoords.longitude
    : (assignedHubCoords && isFiniteCoord(assignedHubCoords.longitude))
    ? assignedHubCoords.longitude
    : 78.3240;

  const renderFallbackView = () => (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
      <View style={styles.fallbackCard}>
        <View style={styles.fallbackHeaderRow}>
          <View style={styles.iconBadge}>
            <Ionicons name="map" size={26} color="#0284c7" />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.fallbackTitle}>{assignedHubName}</Text>
            <Text style={styles.fallbackSub}>Assigned Work Zone</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: isOutOfZone ? "#fee2e2" : "#dcfce7" }]}>
            <Text style={{ color: isOutOfZone ? "#dc2626" : "#16a34a", fontWeight: "800", fontSize: 12 }}>
              {isOutOfZone ? "OUT OF ZONE" : "IN ZONE"}
            </Text>
          </View>
        </View>

        {currentCoords && (
          <View style={styles.liveLocationBox}>
            <Ionicons name="navigate-circle" size={20} color="#16a34a" />
            <Text style={styles.liveLocationText}>
              Live Position: {currentCoords.latitude.toFixed(4)}, {currentCoords.longitude.toFixed(4)}
            </Text>
          </View>
        )}

        <Text style={styles.subLocsHeader}>ASSIGNED COVERAGE AREAS & PINCODES</Text>
        <View style={styles.chipsContainer}>
          {hubSubLocations.length > 0 ? (
            hubSubLocations.map((item, idx) => (
              <View key={idx} style={styles.subChip}>
                <Ionicons name="location-sharp" size={14} color="#0284c7" />
                <Text style={styles.subChipText}>
                  {item.location_name} {item.pincode ? `(${item.pincode})` : ""}
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.noSubsText}>{assignedLocationsStr || "Hub Zone: " + assignedHubName}</Text>
          )}
        </View>

        <TouchableOpacity style={styles.checkZoneBtn} onPress={handleCheckYourZone}>
          <Ionicons name="map-sharp" size={20} color="#000000" />
          <Text style={styles.checkZoneBtnText}>Check Your Zone</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar backgroundColor="#FFD700" barStyle="dark-content" />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/my-role"))}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>

        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            My Zone: {assignedHubName}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {assignedLocationsStr || "Fetching assigned hub..."}
          </Text>
        </View>

        <View
          style={[
            styles.statusPill,
            { backgroundColor: isOutOfZone ? "#fee2e2" : "#dcfce7" },
          ]}
        >
          <Text
            style={{
              color: isOutOfZone ? "#dc2626" : "#16a34a",
              fontWeight: "800",
              fontSize: 12,
            }}
          >
            {isOutOfZone ? "🔴 OUT OF ZONE" : "🟢 IN ZONE"}
          </Text>
        </View>
      </View>

      {/* MAP CONTENT */}
      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator size="large" color="#FFD700" />
          <Text style={styles.loadingText}>Loading assigned hub map...</Text>
        </View>
      ) : dataError ? (
        <View style={styles.errorWrap}>
          <Ionicons name="alert-circle" size={54} color="#ef4444" />
          <Text style={styles.errorTitleText}>{dataError}</Text>
          <Text style={styles.errorSubText}>
            We could not load your assigned hub from the database. Please check your internet connection.
          </Text>
          <View style={styles.errorBtnRow}>
            <TouchableOpacity style={styles.retryBtn} onPress={loadZoneData}>
              <Ionicons name="refresh-sharp" size={18} color="#000000" />
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.goBackBtn}
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/my-role"))}
            >
              <Ionicons name="arrow-back-sharp" size={18} color="#1e293b" />
              <Text style={styles.goBackBtnText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : locationError && !currentCoords ? (
        <View style={styles.errorWrap}>
          <Ionicons name="location-sharp" size={54} color="#ef4444" />
          <Text style={styles.errorTitleText}>{locationError}</Text>
          <Text style={styles.errorSubText}>
            Please turn ON your phone's GPS / Location service and grant location permissions to view your position.
          </Text>
          <View style={styles.errorBtnRow}>
            <TouchableOpacity style={styles.retryBtn} onPress={loadZoneData}>
              <Ionicons name="refresh-sharp" size={18} color="#000000" />
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.goBackBtn}
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/my-role"))}
            >
              <Ionicons name="arrow-back-sharp" size={18} color="#1e293b" />
              <Text style={styles.goBackBtnText}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <MapErrorBoundary fallback={renderFallbackView()}>
            <MapView
              ref={mapRef}
              style={{ flex: 1 }}
              showsUserLocation={false}
              showsMyLocationButton={false}
              showsCompass={false}
              initialRegion={{
                latitude: mapLat,
                longitude: mapLng,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }}
            >
              {/* BLUE DOTTED LINE CONNECTING OUT-OF-ZONE STAFF TO WORK ZONE */}
              {isOutOfZone && currentCoords && isFiniteCoord(currentCoords.latitude) && isFiniteCoord(currentCoords.longitude) && assignedHubCoords && isFiniteCoord(assignedHubCoords.latitude) && isFiniteCoord(assignedHubCoords.longitude) && (
                <Polyline
                  coordinates={[
                    { latitude: currentCoords.latitude, longitude: currentCoords.longitude },
                    { latitude: assignedHubCoords.latitude, longitude: assignedHubCoords.longitude },
                  ]}
                  strokeColor="#0284c7"
                  strokeWidth={4}
                  lineDashPattern={[8, 8]}
                />
              )}

              {/* LIVE PARTNER POSITION MARKER */}
              {currentCoords && isFiniteCoord(currentCoords.latitude) && isFiniteCoord(currentCoords.longitude) && (
                <Marker
                  coordinate={{
                    latitude: currentCoords.latitude,
                    longitude: currentCoords.longitude,
                  }}
                  title="My Live Location"
                  description="Your current position"
                />
              )}

              {/* ASSIGNED ZONE POLYGONS (SUB-LOCATIONS & MASTER HULL) */}
              {(() => {
                let allPincodeBoundaryPoints: Array<{ latitude: number; longitude: number }> = [];

                const pincodeElements = hubSubLocations.map((sub, idx) => {
                  if (!isFiniteCoord(sub.latitude) || !isFiniteCoord(sub.longitude)) return null;

                  const pincodePolyCoords = generatePincodeBoundaryPoints(
                    sub.latitude,
                    sub.longitude,
                    1.2
                  );

                  const validPolyCoords = pincodePolyCoords.filter(
                    (pt) => pt && isFiniteCoord(pt.latitude) && isFiniteCoord(pt.longitude)
                  );

                  if (validPolyCoords.length < 3) return null;

                  allPincodeBoundaryPoints = allPincodeBoundaryPoints.concat(validPolyCoords);

                  return (
                    <Polygon
                      key={`sub-poly-${idx}`}
                      coordinates={validPolyCoords}
                      strokeColor="#0284c7"
                      strokeWidth={2}
                      fillColor="rgba(2, 132, 199, 0.22)"
                      tappable={true}
                      onPress={() => {
                        setSelectedPincodeInfo(
                          `${sub.location_name}${sub.pincode ? " (" + sub.pincode + ")" : ""}`
                        );
                      }}
                    />
                  );
                });

                const masterHubHullCoords = getConvexHullCoordinates(allPincodeBoundaryPoints);
                const validHullCoords = masterHubHullCoords.filter(
                  (pt) => pt && isFiniteCoord(pt.latitude) && isFiniteCoord(pt.longitude)
                );

                return (
                  <>
                    {validHullCoords.length >= 3 && (
                      <Polygon
                        coordinates={validHullCoords}
                        strokeColor="#FFD700"
                        strokeWidth={4}
                        fillColor="rgba(255, 215, 0, 0.16)"
                        tappable={true}
                        onPress={() => {
                          setSelectedPincodeInfo(`Hub Zone: ${assignedHubName}`);
                        }}
                      />
                    )}
                    {pincodeElements}
                  </>
                );
              })()}
            </MapView>
          </MapErrorBoundary>

          {/* BLUE DOTTED LINE DIRECTION BANNER */}
          {isOutOfZone && (
            <View style={styles.directionBanner}>
              <Ionicons name="navigate-circle" size={20} color="#0284c7" />
              <Text style={styles.directionBannerText}>
                🔵 Dotted Line: Check your zone path to return to your work area ({assignedHubName})
              </Text>
            </View>
          )}

          {/* CALLOUT BANNER */}
          {selectedPincodeInfo && (
            <View style={styles.pincodeInfoCallout}>
              <Ionicons name="location-sharp" size={18} color="#0284c7" />
              <Text style={styles.pincodeInfoCalloutText}>{selectedPincodeInfo}</Text>
              <TouchableOpacity
                onPress={() => setSelectedPincodeInfo(null)}
                style={{ marginLeft: 6 }}
              >
                <Ionicons name="close-circle" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>
          )}

          {/* OUT OF ZONE ALERT BANNER */}
          {isOutOfZone && (
            <View style={styles.zoneAlertBanner}>
              <Ionicons name="warning" size={24} color="#dc2626" />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.zoneAlertBannerTitle}>Zone Boundary Crossed!</Text>
                <Text style={styles.zoneAlertBannerMessage}>
                  You are outside your assigned hub zone ({assignedHubName}).
                </Text>
              </View>
            </View>
          )}

          {/* BOTTOM CARD WITH CHECK YOUR ZONE BUTTON */}
          <View style={styles.zoneBottomCard}>
            <View style={{ marginBottom: 8 }}>
              <Text style={styles.zoneCardLabel}>CHECK YOUR ASSIGNED SERVICE ZONE & PINCODES</Text>
              <Text style={styles.zoneCardHubName}>{assignedHubName}</Text>
              <View style={{ maxHeight: 60, marginVertical: 4 }}>
                <ScrollView
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={true}
                  style={{ flexGrow: 0 }}
                >
                  <Text style={styles.zoneCardLocations}>
                    {hubSubLocations.length > 0
                      ? hubSubLocations
                          .map(
                            (item) =>
                              `${item.location_name}${
                                item.pincode ? " (" + item.pincode + ")" : ""
                              }`
                          )
                          .join(" • ")
                      : assignedLocationsStr || "Hub Area: " + assignedHubName}
                  </Text>
                </ScrollView>
              </View>
            </View>

            {/* YELLOW CHECK YOUR ZONE BUTTON */}
            <TouchableOpacity style={styles.checkZoneBtn} onPress={handleCheckYourZone} activeOpacity={0.85}>
              <Ionicons name="map-sharp" size={20} color="#000000" />
              <Text style={styles.checkZoneBtnText}>Check Your Zone</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 64,
    paddingHorizontal: 16,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },
  headerSub: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: "500",
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  loaderWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#64748b",
    fontWeight: "600",
  },
  errorWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    backgroundColor: "#f8fafc",
  },
  errorTitleText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0f172a",
    marginTop: 14,
    textAlign: "center",
  },
  errorSubText: {
    fontSize: 13,
    color: "#64748b",
    marginTop: 8,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 24,
  },
  errorBtnRow: {
    flexDirection: "row",
    gap: 12,
  },
  retryBtn: {
    backgroundColor: "#FFD700",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    elevation: 2,
  },
  retryBtnText: {
    fontWeight: "800",
    color: "#000000",
    fontSize: 14,
  },
  goBackBtn: {
    backgroundColor: "#e2e8f0",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  goBackBtnText: {
    fontWeight: "700",
    color: "#1e293b",
    fontSize: 14,
  },
  directionBanner: {
    position: "absolute",
    top: 12,
    left: 16,
    right: 16,
    backgroundColor: "#e0f2fe",
    borderWidth: 1,
    borderColor: "#0284c7",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    elevation: 4,
  },
  directionBannerText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0369a1",
    flex: 1,
  },
  pincodeInfoCallout: {
    position: "absolute",
    top: 54,
    alignSelf: "center",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    maxWidth: "85%",
  },
  pincodeInfoCalloutText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
    marginLeft: 6,
  },
  zoneAlertBanner: {
    position: "absolute",
    top: 100,
    left: 16,
    right: 16,
    backgroundColor: "#fee2e2",
    borderWidth: 1.5,
    borderColor: "#ef4444",
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    elevation: 6,
  },
  zoneAlertBannerTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#991b1b",
  },
  zoneAlertBannerMessage: {
    fontSize: 12,
    color: "#7f1d1d",
    marginTop: 2,
  },
  zoneBottomCard: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 42,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  zoneCardLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748b",
    letterSpacing: 0.5,
  },
  zoneCardHubName: {
    fontSize: 20,
    fontWeight: "900",
    color: "#0f172a",
    marginTop: 2,
  },
  zoneCardLocations: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 18,
  },
  checkZoneBtn: {
    backgroundColor: "#FFD700",
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    elevation: 3,
  },
  checkZoneBtnText: {
    color: "#000000",
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: 0.3,
  },
  fallbackCard: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 18,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  fallbackHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#e0f2fe",
    justifyContent: "center",
    alignItems: "center",
  },
  fallbackTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#0f172a",
  },
  fallbackSub: {
    fontSize: 12,
    color: "#64748b",
    fontWeight: "600",
  },
  liveLocationBox: {
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: 10,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    gap: 8,
  },
  liveLocationText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#15803d",
  },
  subLocsHeader: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748b",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  chipsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  subChip: {
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  subChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
  },
  noSubsText: {
    fontSize: 13,
    color: "#475569",
  },
});
