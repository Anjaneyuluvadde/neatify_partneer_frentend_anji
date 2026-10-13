import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import { Audio } from "expo-av";
import { Image } from "expo-image";
import * as Location from "expo-location";
import { router, useFocusEffect, usePathname } from "expo-router";
import * as TaskManager from "expo-task-manager";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Dimensions,
  FlatList,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import MapView, { Marker, Polygon, Polyline } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import LocationDisclosureModal from "../components/LocationDisclosureModal";
import PolicyViewerModal from "../components/PolicyViewerModal";
import { authApi, partnerApi } from "../lib/api";
import { scheduleDailyDutyReminders } from "../lib/dutyReminders";
import { LOCATION_TASK_NAME } from "../lib/locationTask";
import { splitAndAddSessionLogs, turnOffDutyAndLogout } from "../lib/logout";
import { supabase } from "../lib/supabase";
import { registerForPushNotificationsAsync } from "./notifications";

const { height, width } = Dimensions.get("window");
const SLIDER_HEIGHT = height * 0.42;

interface HubSubLocation {
  location_name: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
}

export default function MyRoleScreen() {
  const pathname = usePathname();

  const [newCount, setNewCount] = useState(0);
  const [assignedCount, setAssignedCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [cancelledCount, setCancelledCount] = useState(0);
  const [activeSlide, setActiveSlide] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [slides, setSlides] = useState<string[]>([]);
  const [isAvailable, setIsAvailable] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [dutyModalVisible, setDutyModalVisible] = useState(false);
  const [customerCareModalVisible, setCustomerCareModalVisible] =
    useState(false);
  const [targetDutyValue, setTargetDutyValue] = useState<boolean | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationDisclosureVisible, setLocationDisclosureVisible] =
    useState(false);
  const [outOfBoundsModalVisible, setOutOfBoundsModalVisible] = useState(false);
  const [todayDutyMinutes, setTodayDutyMinutes] = useState(0);
  const [weeklyDutyMinutes, setWeeklyDutyMinutes] = useState(0);
  const [monthlyDutyMinutes, setMonthlyDutyMinutes] = useState(0);
  const [dutyStartedAt, setDutyStartedAt] = useState<string | null>(null);
  const [dutyLogsJson, setDutyLogsJson] = useState<Record<string, number>>({});
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [loadingLogout, setLoadingLogout] = useState(false);

  /* 🔥 ROLE SCREEN STATES */
  const [todaysEarnings, setTodaysEarnings] = useState<number>(0);
  const [upcomingJob, setUpcomingJob] = useState<any | null>(null);
  const [partnerProfile, setPartnerProfile] = useState<{
    name: string;
    partnerId: string;
    avatarUrl: string | null;
  }>({
    name: "",
    partnerId: "",
    avatarUrl: null,
  });

  const [policyModalVisible, setPolicyModalVisible] = useState(false);
  const [policyTitle, setPolicyTitle] = useState("Agreements & Terms");
  const [policyHtml, setPolicyHtml] = useState(
    "<p>Loading policy content...</p>",
  );
  const [loadingPolicy, setLoadingPolicy] = useState(false);

  /* AUDIO & VIBRATION ALERT FOR OUT OF BOUNDS */
  const playAlertSound = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        staysActiveInBackground: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        require("../assets/images/zone_alert.wav"),
      );

      let playCount = 0;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish && !status.isLooping) {
          playCount += 1;
          if (playCount < 2) {
            sound.replayAsync();
          } else {
            sound.unloadAsync();
          }
        }
      });

      await sound.playAsync();
      Vibration.vibrate([0, 400, 150, 400, 150, 400]);
    } catch (error) {
      console.log("❌ Alert sound error:", error);
    }
  };

  const triggerOutOfBoundsPopUp = () => {
    setOutOfBoundsModalVisible(true);
    playAlertSound();
  };

  const hasAlertedOutOfBoundsRef = useRef(false);

  /* ZONE MAP & GEOFENCING STATES */
  const [zoneModalVisible, setZoneModalVisible] = useState(false);
  const [isOutOfZone, setIsOutOfZone] = useState(false);
  const [assignedHubName, setAssignedHubName] =
    useState<string>("Assigned Zone");
  const [assignedLocationsStr, setAssignedLocationsStr] = useState<string>("");
  const [assignedHubCoords, setAssignedHubCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [assignedPincodes, setAssignedPincodes] = useState<string[]>([]);
  const [currentCoords, setCurrentCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [currentAreaName, setCurrentAreaName] = useState<string>("");
  const [selectedPincodeInfo, setSelectedPincodeInfo] = useState<string | null>(
    null,
  );
  const [hubSubLocations, setHubSubLocations] = useState<HubSubLocation[]>([]);
  const isZoneDataLoadedRef = useRef(false);

  /* ================= FETCH ASSIGNED ZONE & HUB ================= */
  const fetchAssignedHubZone = async () => {
    try {
      let zoneData: any = null;

      // 1. Try FastAPI partner zone endpoint
      try {
        const response: any = await partnerApi.assignedZone();
        if (response?.data?.hub_name) {
          zoneData = response.data;
        } else if (response?.hub_name) {
          zoneData = response;
        }
      } catch (apiErr) {
        console.log("FastAPI assigned zone failed, trying Supabase:", apiErr);
      }

      // 2. Fallback to Supabase query
      if (!zoneData) {
        const { data: userData } = await supabase.auth.getUser();
        const email = userData?.user?.email?.toLowerCase().trim();

        if (email) {
          const { data: hubs } = await supabase
            .from("hub_category_counts")
            .select("hub, location, category, assigned_staff");

          if (hubs && hubs.length > 0) {
            const match = hubs.find((item) =>
              item.assigned_staff?.toLowerCase().includes(email),
            );

            if (match) {
              const hubName = match.hub || "Assigned Zone";
              zoneData = {
                hub_name: hubName,
                location: match.location || "",
              };
            }
          }
        }
      }

      if (zoneData) {
        const hubName = zoneData.hub_name || "Assigned Zone";
        setAssignedHubName(hubName);
        setAssignedLocationsStr(zoneData.location || "");

        // Fetch sub-locations from hub_locations table
        const { data: hubLocRows } = await supabase
          .from("hub_locations")
          .select("location_name, pincode")
          .eq("hub_name", hubName);

        let locNames: string[] = [];
        let pincodesList: string[] = [];
        let rawSubLocs: Array<{ location_name: string; pincode: string }> = [];

        if (hubLocRows && hubLocRows.length > 0) {
          for (const r of hubLocRows) {
            const locName = (r.location_name || "").trim();
            const pin = String(r.pincode || "").trim();
            if (locName) locNames.push(locName);
            if (pin) pincodesList.push(pin);
            rawSubLocs.push({ location_name: locName, pincode: pin });
          }
        }

        const subLocs: HubSubLocation[] = await Promise.all(
          rawSubLocs.map(async (sub) => {
            let subLat: number | undefined;
            let subLng: number | undefined;
            try {
              const geo = await Promise.race([
                Location.geocodeAsync(
                  `${sub.location_name}, ${sub.pincode || ""}, Telangana, India`,
                ),
                new Promise<null>((resolve) =>
                  setTimeout(() => resolve(null), 2500),
                ),
              ]);
              if (
                geo &&
                geo.length > 0 &&
                typeof geo[0].latitude === "number" &&
                Number.isFinite(geo[0].latitude) &&
                typeof geo[0].longitude === "number" &&
                Number.isFinite(geo[0].longitude)
              ) {
                subLat = geo[0].latitude;
                subLng = geo[0].longitude;
              }
            } catch (e) {}

            return {
              location_name: sub.location_name,
              pincode: sub.pincode,
              latitude: subLat,
              longitude: subLng,
            };
          }),
        );

        if (locNames.length > 0) {
          const formattedLocsWithPins = subLocs
            .map((s) =>
              s.pincode
                ? `${s.location_name} (${s.pincode})`
                : s.location_name,
            )
            .join(" • ");
          setAssignedLocationsStr(formattedLocsWithPins);
        }

        setAssignedPincodes(pincodesList);
        setHubSubLocations(subLocs);

        const validSubCoords = subLocs.filter(
          (s) =>
            typeof s.latitude === "number" &&
            Number.isFinite(s.latitude) &&
            typeof s.longitude === "number" &&
            Number.isFinite(s.longitude),
        );

        if (validSubCoords.length > 0) {
          const sumLat = validSubCoords.reduce(
            (acc, curr) => acc + (curr.latitude || 0),
            0,
          );
          const sumLng = validSubCoords.reduce(
            (acc, curr) => acc + (curr.longitude || 0),
            0,
          );
          setAssignedHubCoords({
            latitude: sumLat / validSubCoords.length,
            longitude: sumLng / validSubCoords.length,
          });
        } else {
          try {
            const geocoded = await Promise.race([
              Location.geocodeAsync(`${hubName}, Telangana, India`),
              new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), 3000),
              ),
            ]);
            if (
              geocoded &&
              geocoded.length > 0 &&
              typeof geocoded[0].latitude === "number" &&
              Number.isFinite(geocoded[0].latitude) &&
              typeof geocoded[0].longitude === "number" &&
              Number.isFinite(geocoded[0].longitude)
            ) {
              setAssignedHubCoords({
                latitude: geocoded[0].latitude,
                longitude: geocoded[0].longitude,
              });
            }
          } catch (e) {}
        }

        isZoneDataLoadedRef.current = true;
        if (currentCoords) {
          checkZoneBoundary(currentCoords.latitude, currentCoords.longitude);
        }
      }
    } catch (err) {
      console.log("Error fetching assigned hub zone:", err);
    }
  };

  /* DRAGGABLE PAN RESPONDER FOR FLOATING BUTTON */
  const pan = useRef(new Animated.ValueXY()).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        pan.setOffset({
          x: (pan.x as any)._value || 0,
          y: (pan.y as any)._value || 0,
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
      },
    }),
  ).current;

  /* HAVERSINE MATHEMATICAL DISTANCE IN KM */
  const getDistanceFromLatLonInKm = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) => {
    const R = 6371;
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

  /* GENERATES CONVEX HULL FOR A SET OF POINTS */
  const getConvexHullCoordinates = (
    points: Array<{ latitude: number; longitude: number }>,
  ) => {
    if (!points || points.length < 3) return [];
    const validPoints = points.filter(
      (p) =>
        p &&
        typeof p.latitude === "number" &&
        Number.isFinite(p.latitude) &&
        typeof p.longitude === "number" &&
        Number.isFinite(p.longitude),
    );
    if (validPoints.length < 3) return [];

    const sorted = [...validPoints].sort((a, b) =>
      a.longitude === b.longitude
        ? a.latitude - b.latitude
        : a.longitude - b.longitude,
    );

    const cross = (o: any, a: any, b: any) =>
      (a.longitude - o.longitude) * (b.latitude - o.latitude) -
      (a.latitude - o.latitude) * (b.longitude - o.longitude);

    const lower: any[] = [];
    for (const p of sorted) {
      while (
        lower.length >= 2 &&
        cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
      ) {
        lower.pop();
      }
      lower.push(p);
    }

    const upper: any[] = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (
        upper.length >= 2 &&
        cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
      ) {
        upper.pop();
      }
      upper.push(p);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
  };

  /* GENERATES REALISTIC ORGANIC BOUNDARY POLYGON FOR A PINCODE */
  const generatePincodeBoundaryPoints = (
    lat: number,
    lng: number,
    radiusKm: number = 1.3,
  ) => {
    if (
      typeof lat !== "number" ||
      !Number.isFinite(lat) ||
      typeof lng !== "number" ||
      !Number.isFinite(lng)
    )
      return [];
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
      if (
        typeof ptLat === "number" &&
        Number.isFinite(ptLat) &&
        typeof ptLng === "number" &&
        Number.isFinite(ptLng)
      ) {
        points.push({
          latitude: ptLat,
          longitude: ptLng,
        });
      }
    }
    return points;
  };

  /* ================= CHECK ZONE BOUNDARY ================= */
  const checkZoneBoundary = async (lat: number, lng: number) => {
    setCurrentCoords({ latitude: lat, longitude: lng });

    if (!isZoneDataLoadedRef.current && hubSubLocations.length === 0) {
      return false;
    }

    let isInside = false;
    let currentAreaStr = "";

    // 1. Hub center check
    if (assignedHubCoords) {
      const distToHubKm = getDistanceFromLatLonInKm(
        lat,
        lng,
        assignedHubCoords.latitude,
        assignedHubCoords.longitude,
      );
      if (distToHubKm <= 4.5) {
        isInside = true;
      }
    }

    // 2. Sub-location proximity check
    if (!isInside && hubSubLocations && hubSubLocations.length > 0) {
      for (const sub of hubSubLocations) {
        if (sub.latitude && sub.longitude) {
          const distToSubKm = getDistanceFromLatLonInKm(
            lat,
            lng,
            sub.latitude,
            sub.longitude,
          );
          if (distToSubKm <= 3.5) {
            isInside = true;
            break;
          }
        }
      }
    }

    try {
      const reversed = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });
      if (reversed && reversed.length > 0) {
        const place = reversed[0];
        const postalCode = String(place.postalCode || "").trim();
        const namePart = (place.name || place.street || "").trim();
        const subregionPart = (
          place.subregion ||
          place.district ||
          place.city ||
          ""
        ).trim();
        currentAreaStr = `${namePart ? namePart + ", " : ""}${subregionPart}${postalCode ? " (" + postalCode + ")" : ""}`;
        setCurrentAreaName(currentAreaStr);

        // 3. Exact Pincode match
        if (!isInside && postalCode) {
          const allPincodes = [
            ...assignedPincodes,
            ...hubSubLocations.map((s) => s.pincode).filter(Boolean),
            ...(assignedLocationsStr.match(/\b\d{6}\b/g) || []),
          ];

          if (
            allPincodes.some((pin) => pin && postalCode.includes(pin.trim()))
          ) {
            isInside = true;
          }
        }

        // 4. Location keyword match
        if (!isInside && assignedLocationsStr) {
          const keywords = assignedLocationsStr
            .toLowerCase()
            .split(/[•,\n()]+/)
            .map((item) => item.trim())
            .filter((item) => item.length > 2 && !/^\d+$/.test(item));

          const currentWords = `${namePart} ${subregionPart}`.toLowerCase();
          const nameMatch = keywords.some(
            (kw) => kw && currentWords.includes(kw),
          );

          if (nameMatch) {
            isInside = true;
          }
        }
      }
    } catch (e) {
      console.log("Reverse geocode error:", e);
    }

    const outOfBounds = !isInside;
    setIsOutOfZone(outOfBounds);

    if (!outOfBounds) {
      hasAlertedOutOfBoundsRef.current = false;
      setOutOfBoundsModalVisible(false);
    } else {
      if (!hasAlertedOutOfBoundsRef.current) {
        hasAlertedOutOfBoundsRef.current = true;
        setOutOfBoundsModalVisible(true);
        triggerZoneBreachAlert(currentAreaStr || "Outside Zone Area");
        triggerOutOfBoundsPopUp();
      }
    }

    // Update location via backend API
    try {
      await partnerApi.updateLocation(lat, lng, outOfBounds);
    } catch {
      // Fallback update to supabase staff_profile
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
          await supabase
            .from("staff_profile")
            .update({
              is_out_of_zone: outOfBounds,
              live_location: `${lat}, ${lng}`,
              live_location_updated_at: new Date().toISOString(),
            })
            .eq("id", userData.user.id);
        }
      } catch (e) {
        console.log("Location update error:", e);
      }
    }

    return outOfBounds;
  };

  const triggerZoneBreachAlert = async (currentArea: string) => {
    try {
      await partnerApi.createLocationAlert({
        alert_type: "OUT_OF_ZONE",
        current_location: currentArea,
        assigned_hub: assignedHubName,
      });
    } catch {
      // Fallback to Supabase
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
          await supabase.from("location_alerts").insert([
            {
              staff_email: userData.user.email,
              alert_type: "OUT_OF_ZONE",
              current_location: currentArea,
              assigned_hub: assignedHubName,
              created_at: new Date().toISOString(),
            },
          ]);
        }
      } catch (err) {
        console.log("Error inserting location alert:", err);
      }
    }
  };

  const handleNavigateToZone = () => {
    if (assignedHubCoords) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${assignedHubCoords.latitude},${assignedHubCoords.longitude}`;
      Linking.openURL(url);
    } else {
      const query = encodeURIComponent(assignedHubName);
      Linking.openURL(
        `https://www.google.com/maps/search/?api=1&query=${query}`,
      );
    }
  };

  const formatMinutesToHours = (totalMinutes: number | string) => {
    const minsNum = Math.max(0, parseInt(String(totalMinutes || 0), 10) || 0);
    if (minsNum === 0) return "0 min";
    const hours = Math.floor(minsNum / 60);
    const mins = minsNum % 60;

    if (hours > 0 && mins > 0) {
      return `${hours}h ${mins} min`;
    } else if (hours > 0) {
      return `${hours}h`;
    } else {
      return `${mins} min`;
    }
  };

  const calculateDutyTotals = (
    logs: Record<string, number> = {},
    active: boolean = false,
    startedAt: string | null = null,
  ) => {
    const todayKey = dayjs().format("YYYY-MM-DD");
    const currentMonthKey = dayjs().format("YYYY-MM");

    const now = dayjs();
    const dayOfWeek = now.day();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const startOfWeek = now.subtract(diffToMonday, "day").startOf("day");
    const endOfWeek = startOfWeek.add(6, "day").endOf("day");

    let todayBase = Number(logs[todayKey] || 0);
    let weeklyBase = 0;
    let monthlyBase = 0;

    Object.entries(logs).forEach(([dateStr, mins]) => {
      const minVal = Number(mins) || 0;
      const d = dayjs(dateStr);

      if (d.isValid()) {
        if (
          (d.isSame(startOfWeek, "day") || d.isAfter(startOfWeek)) &&
          (d.isSame(endOfWeek, "day") || d.isBefore(endOfWeek))
        ) {
          weeklyBase += minVal;
        }
        if (dateStr.startsWith(currentMonthKey)) {
          monthlyBase += minVal;
        }
      }
    });

    let todayActiveMins = 0;
    let weeklyActiveMins = 0;
    let monthlyActiveMins = 0;

    if (active && startedAt) {
      const start = dayjs(startedAt);
      if (start.isValid() && now.isAfter(start)) {
        const startOfToday = now.startOf("day");
        const effectiveTodayStart = start.isAfter(startOfToday)
          ? start
          : startOfToday;
        todayActiveMins = Math.max(0, now.diff(effectiveTodayStart, "minute"));

        const effectiveWeeklyStart = start.isAfter(startOfWeek)
          ? start
          : startOfWeek;
        weeklyActiveMins = Math.max(
          0,
          now.diff(effectiveWeeklyStart, "minute"),
        );

        const startOfMonth = now.startOf("month");
        const effectiveMonthlyStart = start.isAfter(startOfMonth)
          ? start
          : startOfMonth;
        monthlyActiveMins = Math.max(
          0,
          now.diff(effectiveMonthlyStart, "minute"),
        );
      }
    }

    const maxTodayMinutes = Math.max(0, now.diff(now.startOf("day"), "minute"));
    const rawToday = todayBase + todayActiveMins;

    return {
      today: Math.min(rawToday, maxTodayMinutes),
      weekly: weeklyBase + weeklyActiveMins,
      monthly: monthlyBase + monthlyActiveMins,
    };
  };

  const sliderRef = useRef<FlatList>(null);
  const autoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(
    null,
  );
  const liveLocationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  /* ================= LIVE LOCATION TRACKING ================= */
  const startLiveLocationTracking = async (userId: string) => {
    await stopLiveLocationTracking();

    let { status: fgStatus } = await Location.getForegroundPermissionsAsync();
    if (fgStatus !== "granted") {
      const { status: reqStatus } =
        await Location.requestForegroundPermissionsAsync();
      fgStatus = reqStatus;
    }

    if (fgStatus !== "granted") {
      return;
    }

    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      .then(async (pos) => {
        if (pos?.coords) {
          try {
            await partnerApi.updateLocation(pos.coords.latitude, pos.coords.longitude);
          } catch {
            await supabase
              .from("staff_profile")
              .update({
                live_location: `${pos.coords.latitude}, ${pos.coords.longitude}`,
                live_location_updated_at: new Date().toISOString(),
              })
              .eq("id", userId);
          }
          await checkZoneBoundary(pos.coords.latitude, pos.coords.longitude);
        }
      })
      .catch((err) => console.log("Initial live location error:", err));

    try {
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 4000,
          distanceInterval: 5,
        },
        async (pos) => {
          if (pos?.coords) {
            try {
              await partnerApi.updateLocation(pos.coords.latitude, pos.coords.longitude);
            } catch {
              try {
                await supabase
                  .from("staff_profile")
                  .update({
                    live_location: `${pos.coords.latitude}, ${pos.coords.longitude}`,
                    live_location_updated_at: new Date().toISOString(),
                  })
                  .eq("id", userId);
              } catch {}
            }
            checkZoneBoundary(pos.coords.latitude, pos.coords.longitude);
          }
        },
      );
      locationSubscriptionRef.current = sub;
    } catch (err) {
      console.log("Error starting watchPositionAsync:", err);
    }

    try {
      const { status: bgStatus } =
        await Location.requestBackgroundPermissionsAsync();
      if (bgStatus === "granted") {
        const isRegistered =
          await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
        if (!isRegistered) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: Location.Accuracy.High,
            timeInterval: 1000,
            distanceInterval: 1,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: "Neatify Partner Active 📍",
              notificationBody: "Live location tracking active while on-duty.",
              notificationColor: "#FFD700",
            },
          });
        }
      }
    } catch (err) {
      console.log("Notice on background service:", err);
    }
  };

  const stopLiveLocationTracking = async () => {
    if (liveLocationIntervalRef.current) {
      clearInterval(liveLocationIntervalRef.current);
      liveLocationIntervalRef.current = null;
    }
    if (locationSubscriptionRef.current) {
      locationSubscriptionRef.current.remove();
      locationSubscriptionRef.current = null;
    }
    try {
      const isRegistered =
        await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME);
      if (isRegistered) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }
    } catch (err) {
      console.log("Error stopping background task:", err);
    }

    try {
      await partnerApi.clearLocation();
    } catch {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (userData?.user) {
          await supabase
            .from("staff_profile")
            .update({
              live_location: null,
              live_location_updated_at: null,
              work_start_location: null,
              is_out_of_zone: false,
            })
            .eq("id", userData.user.id);
        }
      } catch {}
    }
  };

  useEffect(() => {
    return () => {
      stopLiveLocationTracking();
    };
  }, []);

  /* ================= BACK HANDLER ================= */
  useFocusEffect(
    useCallback(() => {
      const backAction = () => {
        if (router.canGoBack()) {
          router.back();
          return true;
        }
        return false;
      };

      const sub = BackHandler.addEventListener("hardwareBackPress", backAction);
      return () => sub.remove();
    }, []),
  );

  /* ================= NOTIFICATIONS LOAD ================= */
  const loadNotifications = async () => {
    try {
      const list = await partnerApi.notifications();
      if (Array.isArray(list)) {
        setNotifications(list);
        return;
      }
    } catch {}

    const { data: userData } = await supabase.auth.getUser();
    const email = userData?.user?.email;
    if (!email) return;

    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("staff_email", email);

    if (!error) {
      setNotifications(data || []);
    }
  };

  /* ================= FETCH SLIDES ================= */
  const fetchSlides = async () => {
    try {
      const res: any = await partnerApi.heroImages();
      if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
        const urls = res.data.map((item: any) => item.image_url || item.image_path);
        setSlides(urls);
        return;
      }
    } catch {}

    const { data, error } = await supabase
      .from("hero_images")
      .select("image_path")
      .eq("is_active", true)
      .order("priority", { ascending: true });

    if (!error && data) {
      const imageUrls = data.map((item) => {
        const { data: publicUrlData } = supabase.storage
          .from("hero-images-staff")
          .getPublicUrl(item.image_path);
        return publicUrlData.publicUrl;
      });
      setSlides(imageUrls);
    }
  };

  /* ================= FETCH COUNTS ================= */
  const fetchCounts = async () => {
    try {
      const response: any = await partnerApi.dashboard();
      const dashboard = response?.data || response;

      if (dashboard?.bookings) {
        setAssignedCount(dashboard.bookings.assigned || 0);
        setCompletedCount(dashboard.bookings.completed || 0);
        setCancelledCount(dashboard.bookings.cancelled || 0);
        setNewCount(dashboard.bookings.new || 0);
        return;
      }
    } catch {}

    // Fallback to Supabase
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user) return;
    const email = user.email;

    const { count: notif } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("assigned_staff_email", email)
      .eq("is_viewed", false);

    const { count: assigned } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("assigned_staff_email", email)
      .neq("work_status", "COMPLETED")
      .neq("work_status", "CANCELLED");

    const { count: completed } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("assigned_staff_email", email)
      .eq("work_status", "COMPLETED");

    const { count: cancelLogsCount } = await supabase
      .from("staff_cancellations")
      .select("*", { count: "exact", head: true })
      .eq("staff_email", email);

    let cancelledTotal = cancelLogsCount || 0;
    if (cancelledTotal === 0) {
      const { count: cancelledBookingsCount } = await supabase
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("assigned_staff_email", email)
        .eq("work_status", "CANCELLED");
      cancelledTotal = cancelledBookingsCount || 0;
    }

    setNewCount(notif || 0);
    setAssignedCount(assigned || 0);
    setCompletedCount(completed || 0);
    setCancelledCount(cancelledTotal);
  };

  /* ================= FETCH PARTNER PROFILE ================= */
  const fetchPartnerProfile = async () => {
    try {
      const response: any = await partnerApi.profile();
      const profile = response?.data || response;

      if (profile && (profile.name || profile.email)) {
        const name = profile.name || profile.email?.split("@")[0] || "Partner";
        const pid =
          profile.partner_id ||
          profile.staff_id ||
          `NTP${String(profile.id || "").slice(0, 5).toUpperCase()}`;
        const avatar = profile.avatar_url || null;

        setPartnerProfile({ name, partnerId: pid, avatarUrl: avatar });
        return;
      }
    } catch {}

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return;

    const email = userData.user.email;
    const { data: profile } = await supabase
      .from("staff_profile")
      .select("name, phone, avatar_url, staff_id, partner_id, id")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (profile) {
      const name = profile.name || email?.split("@")[0] || "Partner";
      const pid =
        profile.partner_id ||
        profile.staff_id ||
        `NTP${userData.user.id.slice(0, 5).toUpperCase()}`;
      const avatar = profile.avatar_url || null;
      setPartnerProfile({ name, partnerId: pid, avatarUrl: avatar });
    } else if (email) {
      setPartnerProfile({
        name: email.split("@")[0],
        partnerId: `NTP${userData.user.id.slice(0, 5).toUpperCase()}`,
        avatarUrl: null,
      });
    }
  };

  /* ================= FETCH TODAY'S EARNINGS ================= */
  const fetchTodaysEarnings = async () => {
    try {
      const response: any = await partnerApi.dashboard();
      const dashboard = response?.data || response;
      if (dashboard?.earnings?.today !== undefined) {
        setTodaysEarnings(Number(dashboard.earnings.today || 0));
        return;
      }
    } catch {}

    const { data: userData } = await supabase.auth.getUser();
    const email = userData?.user?.email;
    if (!email) return;

    const todayStr = dayjs().format("YYYY-MM-DD");
    let totalSum = 0;
    const processedBookingIds = new Set<string>();

    const { data: earningsData } = await supabase
      .from("staff_earnings")
      .select("booking_id, AMOUNT, earned_at")
      .eq("staff_email", email);

    if (earningsData && earningsData.length > 0) {
      earningsData.forEach((item) => {
        const earnedDate = item.earned_at
          ? dayjs(item.earned_at).format("YYYY-MM-DD")
          : todayStr;
        if (earnedDate === todayStr) {
          totalSum += Number(item.AMOUNT || 0);
          if (item.booking_id) {
            processedBookingIds.add(item.booking_id);
          }
        }
      });
    }

    const { data: completedBookings } = await supabase
      .from("bookings")
      .select("id, staff_earned_amount, work_ended_at")
      .eq("assigned_staff_email", email)
      .eq("work_status", "COMPLETED");

    if (completedBookings && completedBookings.length > 0) {
      completedBookings.forEach((b) => {
        if (!processedBookingIds.has(b.id)) {
          const endedDate = b.work_ended_at
            ? dayjs(b.work_ended_at).format("YYYY-MM-DD")
            : todayStr;
          if (endedDate === todayStr) {
            totalSum += Number(b.staff_earned_amount || 0);
          }
        }
      });
    }

    setTodaysEarnings(totalSum);
  };

  /* ================= FETCH UPCOMING JOB ================= */
  const fetchUpcomingJob = async () => {
    try {
      const response: any = await partnerApi.bookings("assigned");
      const list = Array.isArray(response?.data) ? response.data : [];
      if (list.length > 0) {
        setUpcomingJob(list[0]);
        return;
      }
    } catch {}

    const { data: userData } = await supabase.auth.getUser();
    const email = userData?.user?.email;
    if (!email) return;

    const { data: assignedBookings } = await supabase
      .from("bookings")
      .select("*")
      .eq("assigned_staff_email", email)
      .neq("work_status", "COMPLETED")
      .neq("work_status", "CANCELLED")
      .order("booking_schedule_at", { ascending: true })
      .limit(1);

    if (assignedBookings && assignedBookings.length > 0) {
      const booking = assignedBookings[0];
      try {
        const parsedServices =
          typeof booking.services === "string"
            ? JSON.parse(booking.services)
            : booking.services;

        if (parsedServices && parsedServices.length > 0) {
          const serviceId = parsedServices[0].id;
          const { data: serviceData } = await supabase
            .from("services")
            .select("staff_amount")
            .eq("id", serviceId)
            .single();
          booking.service_staff_amount = serviceData?.staff_amount || "₹0";
        }
      } catch {
        booking.service_staff_amount = "₹0";
      }
      setUpcomingJob(booking);
    } else {
      setUpcomingJob(null);
    }
  };

  /* ================= OPEN AGREEMENTS MODAL ================= */
  const handleOpenAgreements = async () => {
    setPolicyTitle("Agreements & Terms");
    setPolicyModalVisible(true);
    setLoadingPolicy(true);
    try {
      const policies = await partnerApi.getPolicies();
      if (policies && (policies.terms_and_conditions || policies.user_policies)) {
        setPolicyHtml(
          policies.terms_and_conditions ||
          policies.user_policies ||
          "<p>Agreements content not available.</p>",
        );
        return;
      }
    } catch {}

    try {
      const { data } = await supabase
        .from("app_policies")
        .select("terms_and_conditions, user_policies")
        .eq("app_type", "partner")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setPolicyHtml(
          data.terms_and_conditions ||
          data.user_policies ||
          "<p>Agreements content not available.</p>",
        );
      } else {
        setPolicyHtml(
          "<h2>Partner Agreements & Terms</h2><p>1. Partner agrees to maintain high quality service standards.</p><p>2. Live location tracking & duty hours active while on-duty.</p><p>3. Cancellations must comply with partner policy guidelines.</p>",
        );
      }
    } catch {
      setPolicyHtml("<p>Agreements content unavailable.</p>");
    } finally {
      setLoadingPolicy(false);
    }
  };

  const onRefreshScreen = async () => {
    setRefreshing(true);
    await Promise.all([
      fetchPartnerProfile(),
      fetchCounts(),
      fetchTodaysEarnings(),
      fetchUpcomingJob(),
      fetchAvailability(),
      loadNotifications(),
    ]);
    setRefreshing(false);
  };

  /* ================= GET EFFECTIVE USER ID ================= */
  const getEffectiveUserId = async (): Promise<string> => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user?.id) return userData.user.id;
    } catch {}
    try {
      const me = await authApi.me();
      if (me?.id) return me.id;
    } catch {}
    try {
      const prof: any = await partnerApi.profile();
      const pId = prof?.profile?.id || prof?.data?.id || prof?.id;
      if (pId) return pId;
    } catch {}
    return "partner_staff";
  };

  /* ================= FETCH AVAILABILITY ================= */
  const fetchAvailability = async () => {
    const userId = await getEffectiveUserId();

    // 1. Try FastAPI dashboard first (primary backend)
    try {
      const dash = await partnerApi.dashboard();
      if (dash && dash.duty) {
        const active = dash.duty.is_available ?? false;
        setIsAvailable(active);
        setTodayDutyMinutes(Number(dash.duty.today_minutes || 0));
        setWeeklyDutyMinutes(Number(dash.duty.weekly_minutes || 0));
        setMonthlyDutyMinutes(Number(dash.duty.monthly_minutes || 0));

        if (active) {
          hasAlertedOutOfBoundsRef.current = false;
          fetchAssignedHubZone();
          if (!locationSubscriptionRef.current) {
            startLiveLocationTracking(userId);
          }
        } else {
          hasAlertedOutOfBoundsRef.current = false;
          setOutOfBoundsModalVisible(false);
          setIsOutOfZone(false);
          stopLiveLocationTracking();
        }
        return;
      }
    } catch (e) {
      console.log("FastAPI dashboard availability notice:", e);
    }

    // 2. Fallback to Supabase staff_profile
    try {
      const { data } = await supabase
        .from("staff_profile")
        .select(
          "is_available, duty_started_at, duty_logs_json, duty_sessions_json, is_blocked",
        )
        .eq("id", userId)
        .maybeSingle();

      if (data?.is_blocked) {
        await stopLiveLocationTracking();
        setIsAvailable(false);
        await turnOffDutyAndLogout(userId);
        Alert.alert(
          "Account Blocked",
          "Your account has been temporarily blocked. Contact info@thaneatifyteam.in for more details.",
        );
        router.replace("./login");
        return;
      }

      const active = data?.is_available ?? false;
      const startedAt = data?.duty_started_at ?? null;
      const logs = (data?.duty_logs_json as Record<string, number>) || {};

      setIsAvailable(active);
      setDutyStartedAt(startedAt);
      setDutyLogsJson(logs);

      const totals = calculateDutyTotals(logs, active, startedAt);
      setTodayDutyMinutes(totals.today);
      setWeeklyDutyMinutes(totals.weekly);
      setMonthlyDutyMinutes(totals.monthly);

      if (active) {
        hasAlertedOutOfBoundsRef.current = false;
        await fetchAssignedHubZone();
        if (!locationSubscriptionRef.current) {
          startLiveLocationTracking(userId);
        }
      } else {
        hasAlertedOutOfBoundsRef.current = false;
        setOutOfBoundsModalVisible(false);
        setIsOutOfZone(false);
        stopLiveLocationTracking();
      }
    } catch (err) {
      console.log("Supabase availability fetch error:", err);
    }
  };

  /* LIVE DUTY TIMER TICK */
  useEffect(() => {
    if (!isAvailable || !dutyStartedAt) return;

    const updateTimer = () => {
      const totals = calculateDutyTotals(dutyLogsJson, true, dutyStartedAt);
      setTodayDutyMinutes(totals.today);
      setWeeklyDutyMinutes(totals.weekly);
      setMonthlyDutyMinutes(totals.monthly);

      supabase.auth.getUser().then(({ data: userData }) => {
        if (userData?.user) {
          const todayKey = dayjs().format("YYYY-MM-DD");
          const start = dayjs(dutyStartedAt);
          let todayActiveMins = 0;
          if (start.isValid()) {
            const startOfToday = dayjs().startOf("day");
            const effectiveTodayStart = start.isAfter(startOfToday)
              ? start
              : startOfToday;
            todayActiveMins = Math.max(
              0,
              dayjs().diff(effectiveTodayStart, "minute"),
            );
          }

          const liveLogs = { ...dutyLogsJson };
          const baseTodayMins = Number(dutyLogsJson[todayKey] || 0);
          liveLogs[todayKey] = baseTodayMins + todayActiveMins;

          supabase
            .from("staff_profile")
            .update({
              duty_logs_json: liveLogs,
              today_duty_minutes: String(totals.today),
              weekly_duty_minutes: String(totals.weekly),
              monthly_duty_minutes: String(totals.monthly),
            })
            .eq("id", userData.user.id)
            .then(() => {});
        }
      });
    };

    updateTimer();
    const interval = setInterval(updateTimer, 15000);
    return () => clearInterval(interval);
  }, [isAvailable, dutyStartedAt, dutyLogsJson]);

  useEffect(() => {
    fetchSlides();
  }, []);

  useFocusEffect(
    useCallback(() => {
      const initScreen = async () => {
        await fetchAssignedHubZone();
        fetchPartnerProfile();
        fetchCounts();
        fetchTodaysEarnings();
        fetchUpcomingJob();
        fetchAvailability();
        loadNotifications();
      };
      initScreen();
    }, []),
  );

  useEffect(() => {
    const setupNotifications = async () => {
      try {
        await scheduleDailyDutyReminders();
        const token = await registerForPushNotificationsAsync();

        if (token) {
          try {
            await partnerApi.updatePushToken(token);
          } catch {
            const { data } = await supabase.auth.getUser();
            const user = data?.user;
            if (user) {
              await supabase
                .from("staff_profile")
                .update({ push_token: token })
                .eq("id", user.id);
            }
          }
        }
      } catch (error) {
        console.log("❌ Notification setup error:", error);
      }
    };

    setupNotifications();
  }, []);

  const unreadCount = notifications.filter((item) => !item.is_read).length;

  /* ================= UPDATE AVAILABILITY ================= */
  const handleToggleAvailability = (value: boolean) => {
    setTargetDutyValue(value);
    setDutyModalVisible(true);
  };

  const proceedWithDutyActivation = async (userId: string) => {
    const hasGps = await Location.hasServicesEnabledAsync();
    if (!hasGps) {
      Alert.alert(
        "Location Services Disabled 🛰️",
        "Mobile GPS/Location service is turned OFF. Please turn ON Location in your phone settings to go ON-DUTY.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }

    setLocationLoading(true);

    let initialLocStr = "";
    let isOut = false;
    try {
      const initialPos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      initialLocStr = `${initialPos.coords.latitude}, ${initialPos.coords.longitude}`;

      await fetchAssignedHubZone();
      isOut = await checkZoneBoundary(
        initialPos.coords.latitude,
        initialPos.coords.longitude,
      );
    } catch (e) {
      console.log("Error getting initial location:", e);
    } finally {
      setLocationLoading(false);
    }

    const nowStr = new Date().toISOString();
    setIsAvailable(true);
    setDutyStartedAt(nowStr);

    const totals = calculateDutyTotals(dutyLogsJson, true, nowStr);

    // Call backend API duty on
    try {
      await partnerApi.turnOnDuty(initialLocStr);
      console.log("✅ FastAPI turn on duty success");
    } catch (apiErr) {
      console.log("FastAPI duty on notice:", apiErr);
    }

    try {
      const { data: profile } = await supabase
        .from("staff_profile")
        .select("duty_sessions_json")
        .eq("id", userId)
        .maybeSingle();

      const existingSessions: any[] =
        (profile?.duty_sessions_json as any[]) || [];
      const newSession = {
        id: `sess_${Date.now()}`,
        date: dayjs().format("YYYY-MM-DD"),
        on_at: nowStr,
        off_at: null,
        location: initialLocStr,
        duration_minutes: null,
      };

      const updatedSessions = [...existingSessions, newSession];

      await supabase
        .from("staff_profile")
        .update({
          is_available: true,
          is_out_of_zone: isOut,
          duty_started_at: nowStr,
          work_start_location: initialLocStr,
          live_location: initialLocStr,
          live_location_updated_at: nowStr,
          duty_sessions_json: updatedSessions,
        })
        .eq("id", userId);
    } catch (supaErr) {
      console.log("Supabase duty session update notice:", supaErr);
    }

    startLiveLocationTracking(userId);

    setTodayDutyMinutes(totals.today);
    setWeeklyDutyMinutes(totals.weekly);
    setMonthlyDutyMinutes(totals.monthly);

    if (isOut) {
      triggerOutOfBoundsPopUp();
    }
  };

  const handleLocationDisclosureContinue = async () => {
    setLocationDisclosureVisible(false);

    const userId = await getEffectiveUserId();

    let { status: fgStatus } = await Location.getForegroundPermissionsAsync();
    if (fgStatus !== "granted") {
      const res = await Location.requestForegroundPermissionsAsync();
      fgStatus = res.status;
    }

    if (fgStatus !== "granted") {
      Alert.alert(
        "Location Permission Required 📍",
        "Permission to access location was denied. Please grant location access in your device settings to go ON-DUTY.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }

    try {
      await Location.requestBackgroundPermissionsAsync();
    } catch {}

    await proceedWithDutyActivation(userId);
  };

  const handleLocationDisclosureCancel = () => {
    setLocationDisclosureVisible(false);
    setTargetDutyValue(null);
  };

  const confirmDutyChange = async () => {
    if (targetDutyValue === null) return;
    const value = targetDutyValue;
    setDutyModalVisible(false);

    const userId = await getEffectiveUserId();

    if (value === true) {
      let { status: fgStatus } =
        await Location.getForegroundPermissionsAsync();
      if (fgStatus !== "granted") {
        const res = await Location.requestForegroundPermissionsAsync();
        fgStatus = res.status;
      }

      if (fgStatus !== "granted") {
        setLocationDisclosureVisible(true);
        return;
      }

      try {
        const { status: bgStatus } =
          await Location.getBackgroundPermissionsAsync();
        if (bgStatus !== "granted") {
          await Location.requestBackgroundPermissionsAsync();
        }
      } catch {}

      await proceedWithDutyActivation(userId);
    } else {
      // Turn OFF duty
      await stopLiveLocationTracking();
      setIsAvailable(false);
      setIsOutOfZone(false);
      setOutOfBoundsModalVisible(false);

      try {
        await partnerApi.turnOffDuty();
        console.log("✅ FastAPI turn off duty success");
      } catch (apiErr) {
        console.log("FastAPI turn off duty error:", apiErr);
      }

      const activeStartedAt = dutyStartedAt;
      const nowStr = new Date().toISOString();
      const existingLogs: Record<string, number> = dutyLogsJson || {};

      let updatedLogs = existingLogs;
      let sessionMinutes = 0;
      if (activeStartedAt) {
        const start = dayjs(activeStartedAt);
        const now = dayjs();
        sessionMinutes = Math.max(0, now.diff(start, "minute"));
        updatedLogs = splitAndAddSessionLogs(
          existingLogs,
          activeStartedAt,
          nowStr,
        );
      }

      const totals = calculateDutyTotals(updatedLogs, false, null);

      setDutyStartedAt(null);
      setDutyLogsJson(updatedLogs);

      setTodayDutyMinutes(totals.today);
      setWeeklyDutyMinutes(totals.weekly);
      setMonthlyDutyMinutes(totals.monthly);

      try {
        const { data: profile } = await supabase
          .from("staff_profile")
          .select("duty_sessions_json")
          .eq("id", userId)
          .maybeSingle();

        const existingSessions: any[] =
          (profile?.duty_sessions_json as any[]) || [];
        let foundActive = false;
        const updatedSessions = existingSessions.map((sess: any) => {
          if (!sess.off_at) {
            foundActive = true;
            return {
              ...sess,
              off_at: nowStr,
              duration_minutes: sessionMinutes,
            };
          }
          return sess;
        });

        if (!foundActive && activeStartedAt) {
          updatedSessions.push({
            id: `sess_${Date.now()}`,
            date: dayjs(activeStartedAt).format("YYYY-MM-DD"),
            on_at: activeStartedAt,
            off_at: nowStr,
            location: null,
            duration_minutes: sessionMinutes,
          });
        }

        await supabase
          .from("staff_profile")
          .update({
            is_available: false,
            is_out_of_zone: false,
            work_start_location: null,
            live_location: null,
            live_location_updated_at: null,
            duty_logs_json: updatedLogs,
            duty_sessions_json: updatedSessions,
            today_duty_minutes: String(totals.today),
            weekly_duty_minutes: String(totals.weekly),
            monthly_duty_minutes: String(totals.monthly),
          })
          .eq("id", userId);
      } catch (supaErr) {
        console.log("Supabase duty off update notice:", supaErr);
      }
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const confirmLogoutAction = async () => {
    setLoadingLogout(true);
    try {
      setIsAvailable(false);
      await stopLiveLocationTracking();
      try {
        await authApi.logout();
      } catch {}
      const { data: userData } = await supabase.auth.getUser();
      await turnOffDutyAndLogout(userData?.user?.id);
      setShowLogoutModal(false);
      router.replace("/login");
    } catch (err) {
      console.log("Logout error:", err);
    } finally {
      setLoadingLogout(false);
    }
  };

  const handleCustomerCare = () => {
    setCustomerCareModalVisible(true);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* TOP HEADER */}
      <View style={styles.header}>
        <View style={styles.profileHeaderLeft}>
          <TouchableOpacity
            onPress={() => router.push("/my-account")}
            activeOpacity={0.8}
            style={styles.profileInfoContainer}
          >
            <Text style={styles.headerGreeting}>
              Hi {partnerProfile.name || "Partner"} 👋
            </Text>
          </TouchableOpacity>

          <View style={styles.headerDutyWrapper}>
            <Text
              style={[
                styles.headerDutyLabel,
                {
                  color: "#0d0b01",
                },
              ]}
            >
              {isAvailable ? "ON DUTY" : "OFF DUTY"}
            </Text>
            <Switch
              value={isAvailable}
              onValueChange={handleToggleAvailability}
              trackColor={{ false: "#d1d5db", true: "#22c55e" }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.bellIcon}
            onPress={() => router.push("/new-services")}
          >
            <Ionicons name="notifications" size={24} color="#000" />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setShowMenu(true)}>
            {partnerProfile.avatarUrl ? (
              <Image
                source={{ uri: partnerProfile.avatarUrl }}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                }}
                contentFit="cover"
              />
            ) : (
              <Ionicons name="person-circle-outline" size={38} color="#000" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* DROPDOWN MENU */}
      {showMenu && (
        <Pressable style={styles.overlay} onPress={() => setShowMenu(false)} />
      )}
      {showMenu && (
        <View style={styles.menu}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              router.push("/my-account");
            }}
          >
            <Text style={styles.menuText}>My Account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              handleOpenAgreements();
            }}
          >
            <Text style={styles.menuText}>Agreements</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              handleCustomerCare();
            }}
          >
            <Text style={styles.menuText}>Support</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setShowMenu(false);
              handleLogout();
            }}
          >
            <Text style={[styles.menuText, { color: "red" }]}>Logout</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={[{ key: "main" }]}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefreshScreen} />
        }
        renderItem={() => (
          <View style={styles.container}>
            <StatusBar backgroundColor="#FFD700" barStyle="dark-content" />

            {/* OUT OF BOUNDS WARNING BANNER ON HOME SCREEN */}
            {isOutOfZone && (
              <TouchableOpacity
                style={styles.outOfZoneBanner}
                onPress={() => {
                  fetchAssignedHubZone();
                  setZoneModalVisible(true);
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="warning" size={24} color="#fff" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.outOfZoneBannerTitle}>
                    OUT OF BOUNDS ALERT! 🚨
                  </Text>
                  <Text style={styles.outOfZoneBannerSub}>
                    Outside assigned zone ({assignedHubName}). Tap to view zone
                    & navigate.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#fff" />
              </TouchableOpacity>
            )}

            {/* TODAY'S EARNINGS DARK CARD */}
            <TouchableOpacity
              style={styles.earningsCard}
              onPress={() => router.push("/weekly-screen")}
              activeOpacity={0.9}
            >
              <View style={styles.earningsCardTop}>
                <Text style={styles.earningsCardLabel}>Today's Earnings</Text>
                <View style={styles.chartIconWrapper}>
                  <Ionicons name="stats-chart" size={22} color="#FFD700" />
                </View>
              </View>

              <Text style={styles.earningsCardAmount}>
                ₹{todaysEarnings.toLocaleString("en-IN")}
              </Text>

              <View style={styles.earningsCardBottom}>
                <Text style={styles.earningsViewDetails}>View Details →</Text>
              </View>
            </TouchableOpacity>

            {/* SERVICE STATUS SUMMARY CARDS (ASSIGNED, COMPLETED, CANCELLED) */}
            <View style={styles.statusCardsRow}>
              {/* ASSIGNED */}
              <TouchableOpacity
                style={styles.statusCard}
                onPress={() => router.push("/assigned-services")}
                activeOpacity={0.8}
              >
                <View style={styles.statusIconBox}>
                  <Ionicons name="document-text" size={22} color="#D97706" />
                </View>
                <Text style={styles.statusCount}>{assignedCount}</Text>
                <Text style={styles.statusLabel}>Assigned</Text>
              </TouchableOpacity>

              {/* COMPLETED */}
              <TouchableOpacity
                style={styles.statusCard}
                onPress={() => router.push("/dashboard")}
                activeOpacity={0.8}
              >
                <View style={styles.statusIconBox}>
                  <Ionicons name="checkmark-circle" size={22} color="#D97706" />
                </View>
                <Text style={styles.statusCount}>{completedCount}</Text>
                <Text style={styles.statusLabel}>Completed</Text>
              </TouchableOpacity>

              {/* CANCELLED */}
              <TouchableOpacity
                style={styles.statusCard}
                onPress={() => router.push("/cancellations")}
                activeOpacity={0.8}
              >
                <View style={styles.statusIconBox}>
                  <Ionicons name="close-circle" size={22} color="#D97706" />
                </View>
                <Text style={styles.statusCount}>{cancelledCount}</Text>
                <Text style={styles.statusLabel}>Cancelled</Text>
              </TouchableOpacity>
            </View>

            {/* WORKING HOURS SECTION */}
            <View style={styles.sectionHeaderWrapper}>
              <Text style={styles.sectionHeaderText}>Working Hours</Text>
            </View>

            {/* DUTY HOURS SUMMARY BOXES */}
            <View style={styles.dutyHoursRow}>
              {/* TODAY */}
              <View style={styles.dutyHoursBox}>
                <Text style={styles.dutyHoursTitle}>Today</Text>
                <Text style={styles.dutyHoursValue}>
                  {formatMinutesToHours(todayDutyMinutes)}
                </Text>
              </View>

              {/* WEEKLY */}
              <View style={styles.dutyHoursBox}>
                <Text style={styles.dutyHoursTitle}>Weekly</Text>
                <Text style={styles.dutyHoursValue}>
                  {formatMinutesToHours(weeklyDutyMinutes)}
                </Text>
              </View>

              {/* MONTHLY */}
              <View style={styles.dutyHoursBox}>
                <Text style={styles.dutyHoursTitle}>Monthly</Text>
                <Text style={styles.dutyHoursValue}>
                  {formatMinutesToHours(monthlyDutyMinutes)}
                </Text>
              </View>
            </View>

            {/* AVAILABILITY CALENDAR BUTTON */}
            <TouchableOpacity
              style={styles.availabilityCalendarBtn}
              onPress={() => router.push("/availability-calendar")}
              activeOpacity={0.85}
            >
              <Ionicons name="calendar-outline" size={22} color="#000" />
              <Text style={styles.availabilityCalendarBtnText}>
                Availability Calendar
              </Text>
            </TouchableOpacity>

            {/* UPCOMING JOB SECTION */}
            <View style={styles.upcomingJobSection}>
              <Text style={styles.upcomingJobHeader}>Upcoming Job</Text>

              {upcomingJob ? (
                <View style={styles.upcomingJobCard}>
                  <View style={styles.upcomingJobTopRow}>
                    <View style={styles.upcomingJobIconBox}>
                      <Ionicons name="sparkles" size={24} color="#D97706" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.upcomingJobTitle} numberOfLines={1}>
                        {Array.isArray(upcomingJob.services)
                          ? upcomingJob.services?.[0]?.title ||
                            upcomingJob.services?.[0]?.name ||
                            "Service Booking"
                          : upcomingJob.service_name || "Deep Cleaning Service"}
                      </Text>
                      <Text style={styles.upcomingJobPayout}>
                        {upcomingJob.service_staff_amount || "₹0"} (Your Payout)
                      </Text>
                      <Text style={styles.upcomingJobDateTime}>
                        {upcomingJob.booking_date || "Today"},{" "}
                        {upcomingJob.booking_time || "10:00 AM"}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.upcomingJobAddressRow}>
                    <Ionicons name="location-sharp" size={18} color="#111827" />
                    <Text
                      style={styles.upcomingJobAddressText}
                      numberOfLines={2}
                    >
                      {upcomingJob.full_address ||
                        upcomingJob.location ||
                        "Assigned Location"}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.upcomingJobBtn}
                    onPress={() =>
                      router.push({
                        pathname: "/assigned-services",
                        params: { booking: JSON.stringify(upcomingJob) },
                      })
                    }
                    activeOpacity={0.85}
                  >
                    <Text style={styles.upcomingJobBtnText}>View Details</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.noJobCard}>
                  <View style={styles.noJobIconCircle}>
                    <Ionicons
                      name="briefcase-outline"
                      size={26}
                      color="#D97706"
                    />
                  </View>
                  <Text style={styles.noJobTitle}>No Upcoming Jobs</Text>
                  <Text style={styles.noJobSub}>
                    Stay ON-DUTY to receive and accept new customer bookings in
                    real-time.
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}
      />

      {/* CUSTOM DUTY MODAL */}
      <Modal visible={dutyModalVisible} transparent animationType="fade">
        <View style={styles.dutyModalOverlay}>
          <View style={styles.dutyModalCard}>
            <View style={styles.dutyIconCircle}>
              <Ionicons
                name={targetDutyValue ? "power" : "power-outline"}
                size={30}
                color={targetDutyValue ? "#16a34a" : "#dc2626"}
              />
            </View>

            <Text style={styles.dutyModalTitle}>
              {targetDutyValue ? "Go ON-DUTY?" : "Go OFF-DUTY?"}
            </Text>
            <Text style={styles.dutyModalMessage}>
              {targetDutyValue
                ? "Are you sure you want to go ON-DUTY?"
                : "Are you sure you want to go OFF-DUTY?"}
            </Text>

            <View style={styles.dutyButtonRow}>
              <TouchableOpacity
                style={styles.dutyCancelBtn}
                onPress={() => setDutyModalVisible(false)}
              >
                <Text style={styles.dutyCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dutyConfirmBtn}
                onPress={confirmDutyChange}
              >
                <Text style={styles.dutyConfirmText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* CUSTOM CUSTOMER CARE MODAL */}
      <Modal
        visible={customerCareModalVisible}
        transparent
        animationType="fade"
      >
        <View style={styles.dutyModalOverlay}>
          <View style={styles.dutyModalCard}>
            <View style={styles.dutyIconCircle}>
              <Ionicons name="headset" size={30} color="#000" />
            </View>

            <Text style={styles.dutyModalTitle}>Customer Care 🎧</Text>
            <Text style={styles.dutyModalMessage}>+91 7617618567</Text>

            <View style={styles.dutyButtonRow}>
              <TouchableOpacity
                style={styles.dutyCancelBtn}
                onPress={() => setCustomerCareModalVisible(false)}
              >
                <Text style={styles.dutyCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dutyConfirmBtn}
                onPress={() => {
                  setCustomerCareModalVisible(false);
                  Linking.openURL("tel:+917617618567");
                }}
              >
                <Text style={styles.dutyConfirmText}>Call</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* LOCATION LOADING MODAL OVERLAY */}
      <Modal visible={locationLoading} transparent animationType="fade">
        <View style={styles.dutyModalOverlay}>
          <View style={styles.dutyModalCard}>
            <ActivityIndicator
              size="large"
              color="#FFD700"
              style={{ marginBottom: 16 }}
            />
            <Text style={styles.dutyModalTitle}>Fetching Location... 📍</Text>
            <Text style={styles.dutyModalMessage}>
              Getting your live GPS location and verifying your assigned zone
              boundary...
            </Text>
          </View>
        </View>
      </Modal>

      {/* CUSTOM PALE-YELLOW ROUNDED OUT OF BOUNDS POPUP MODAL */}
      <Modal
        visible={outOfBoundsModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setOutOfBoundsModalVisible(false)}
      >
        <View style={styles.boundsModalOverlay}>
          <View style={styles.boundsModalCard}>
            <View style={styles.boundsIconCircle}>
              <Ionicons name="warning" size={32} color="#D97706" />
            </View>

            <Text style={styles.boundsModalTitle}>Out of Bounds Alert! 🚨</Text>
            <Text style={styles.boundsModalMessage}>
              You are currently outside your assigned zone (
              {assignedHubName || "Assigned Zone"}). Please move inside your
              zone to receive and complete customer bookings.
            </Text>

            <View style={styles.boundsButtonColumn}>
              <TouchableOpacity
                style={styles.boundsPrimaryBtn}
                onPress={() => {
                  setOutOfBoundsModalVisible(false);
                  router.push({
                    pathname: "/zone-map" as any,
                    params: {
                      hubName: assignedHubName,
                      locationsStr: assignedLocationsStr,
                      outOfZone: isOutOfZone ? "true" : "false",
                    },
                  });
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="map-outline" size={20} color="#000" />
                <Text style={styles.boundsPrimaryBtnText}>
                  View Zone Map 📍
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.boundsDismissBtn}
                onPress={() => setOutOfBoundsModalVisible(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.boundsDismissText}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* PROMINENT LOCATION DISCLOSURE MODAL */}
      <LocationDisclosureModal
        visible={locationDisclosureVisible}
        onContinue={handleLocationDisclosureContinue}
        onCancel={handleLocationDisclosureCancel}
      />

      {/* DRAGGABLE FLOATING ROUND CIRCULAR ZONE MAP BUTTON */}
      <Animated.View
        style={[
          styles.draggableContainer,
          {
            transform: [{ translateX: pan.x }, { translateY: pan.y }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={[
            styles.floatingZoneBtn,
            { backgroundColor: isOutOfZone ? "#ef4444" : "#16a34a" },
          ]}
          onPress={() => {
            router.push({
                    pathname: "/zone-map" as any,
                    params: {
                      hubName: assignedHubName,
                      locationsStr: assignedLocationsStr,
                      outOfZone: isOutOfZone ? "true" : "false",
                    },
                  });
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="map" size={24} color="#ffffff" />
          <Text style={styles.floatingBtnText}>
            {isOutOfZone ? "OUT OF BOUNDS" : "IN ZONE"}
          </Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ZONE MAP OVERLAY MODAL */}
      <Modal
        visible={zoneModalVisible}
        animationType="slide"
        transparent={false}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
          {/* HEADER */}
          <View style={styles.zoneModalHeader}>
            <TouchableOpacity
              style={styles.zoneBackBtn}
              onPress={() => setZoneModalVisible(false)}
            >
              <Ionicons name="arrow-back" size={24} color="#000" />
            </TouchableOpacity>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.zoneModalHeaderTitle}>
                My Zone: {assignedHubName}
              </Text>
              <Text style={styles.zoneModalHeaderSub} numberOfLines={1}>
                {assignedLocationsStr || "Fetching assigned hub..."}
              </Text>
            </View>
            <View
              style={[
                styles.zoneHeaderStatusPill,
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

          {/* MAP VIEW */}
          <View style={{ flex: 1 }}>
            <MapView
              style={{ flex: 1 }}
              initialRegion={{
                latitude:
                  currentCoords &&
                  typeof currentCoords.latitude === "number" &&
                  Number.isFinite(currentCoords.latitude)
                    ? currentCoords.latitude
                    : assignedHubCoords &&
                      typeof assignedHubCoords.latitude === "number" &&
                      Number.isFinite(assignedHubCoords.latitude)
                    ? assignedHubCoords.latitude
                    : 17.4851,
                longitude:
                  currentCoords &&
                  typeof currentCoords.longitude === "number" &&
                  Number.isFinite(currentCoords.longitude)
                    ? currentCoords.longitude
                    : assignedHubCoords &&
                      typeof assignedHubCoords.longitude === "number" &&
                      Number.isFinite(assignedHubCoords.longitude)
                    ? assignedHubCoords.longitude
                    : 78.324,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }}
            >
              {isOutOfZone &&
                currentCoords &&
                typeof currentCoords.latitude === "number" &&
                Number.isFinite(currentCoords.latitude) &&
                typeof currentCoords.longitude === "number" &&
                Number.isFinite(currentCoords.longitude) &&
                assignedHubCoords &&
                typeof assignedHubCoords.latitude === "number" &&
                Number.isFinite(assignedHubCoords.latitude) &&
                typeof assignedHubCoords.longitude === "number" &&
                Number.isFinite(assignedHubCoords.longitude) && (
                  <Polyline
                    coordinates={[
                      {
                        latitude: currentCoords.latitude,
                        longitude: currentCoords.longitude,
                      },
                      {
                        latitude: assignedHubCoords.latitude,
                        longitude: assignedHubCoords.longitude,
                      },
                    ]}
                    strokeColor="#0284c7"
                    strokeWidth={4}
                    lineDashPattern={[8, 8]}
                  />
                )}

              {currentCoords &&
                typeof currentCoords.latitude === "number" &&
                Number.isFinite(currentCoords.latitude) &&
                typeof currentCoords.longitude === "number" &&
                Number.isFinite(currentCoords.longitude) && (
                  <Marker
                    coordinate={{
                      latitude: currentCoords.latitude,
                      longitude: currentCoords.longitude,
                    }}
                    title="My Live Location"
                    description={currentAreaName || "Your current position"}
                  />
                )}

              {(() => {
                let allPincodeBoundaryPoints: Array<{
                  latitude: number;
                  longitude: number;
                }> = [];

                const pincodeElements = hubSubLocations.map((sub, idx) => {
                  if (
                    !sub.latitude ||
                    !sub.longitude ||
                    !Number.isFinite(sub.latitude) ||
                    !Number.isFinite(sub.longitude)
                  )
                    return null;

                  const pincodePolyCoords = generatePincodeBoundaryPoints(
                    sub.latitude,
                    sub.longitude,
                    1.2,
                  );

                  const validPolyCoords = pincodePolyCoords.filter(
                    (pt) =>
                      pt &&
                      typeof pt.latitude === "number" &&
                      Number.isFinite(pt.latitude) &&
                      typeof pt.longitude === "number" &&
                      Number.isFinite(pt.longitude),
                  );

                  if (validPolyCoords.length < 3) return null;

                  allPincodeBoundaryPoints =
                    allPincodeBoundaryPoints.concat(validPolyCoords);

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
                          `${sub.location_name}${sub.pincode ? " (" + sub.pincode + ")" : ""}`,
                        );
                      }}
                    />
                  );
                });

                const masterHubHullCoords = getConvexHullCoordinates(
                  allPincodeBoundaryPoints,
                );
                const validHullCoords = masterHubHullCoords.filter(
                  (pt) =>
                    pt &&
                    typeof pt.latitude === "number" &&
                    Number.isFinite(pt.latitude) &&
                    typeof pt.longitude === "number" &&
                    Number.isFinite(pt.longitude),
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
                          setSelectedPincodeInfo(
                            `Hub Zone: ${assignedHubName}`,
                          );
                        }}
                      />
                    )}
                    {pincodeElements}
                  </>
                );
              })()}
            </MapView>

            {selectedPincodeInfo && (
              <View style={styles.pincodeInfoCallout}>
                <Ionicons name="location-sharp" size={18} color="#0284c7" />
                <Text style={styles.pincodeInfoCalloutText}>
                  {selectedPincodeInfo}
                </Text>
                <TouchableOpacity
                  onPress={() => setSelectedPincodeInfo(null)}
                  style={{ marginLeft: 6 }}
                >
                  <Ionicons name="close-circle" size={20} color="#64748b" />
                </TouchableOpacity>
              </View>
            )}

            {isOutOfZone && (
              <View style={styles.zoneAlertBanner}>
                <Ionicons name="warning" size={24} color="#dc2626" />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.zoneAlertBannerTitle}>
                    Zone Boundary Crossed!
                  </Text>
                  <Text style={styles.zoneAlertBannerMessage}>
                    You are outside your assigned hub zone ({assignedHubName}).
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.zoneBottomCard}>
              <View style={{ marginBottom: 8 }}>
                <Text style={styles.zoneCardLabel}>
                  ASSIGNED SERVICE ZONE & PINCODES
                </Text>
                <Text style={styles.zoneCardHubName}>{assignedHubName}</Text>
                <ScrollView
                  style={styles.pincodesScrollView}
                  nestedScrollEnabled={true}
                  showsVerticalScrollIndicator={true}
                >
                  <Text style={styles.zoneCardLocations}>
                    {hubSubLocations.length > 0
                      ? hubSubLocations
                          .map(
                            (item) =>
                              `${item.location_name}${item.pincode ? " (" + item.pincode + ")" : ""}`,
                          )
                          .join(" • ")
                      : assignedLocationsStr || "Hub Area: " + assignedHubName}
                  </Text>
                </ScrollView>
              </View>

              <TouchableOpacity
                style={styles.navigateBtn}
                onPress={handleNavigateToZone}
              >
                <Ionicons name="navigate-sharp" size={20} color="#000000" />
                <Text style={styles.navigateBtnText}>
                  Join Work Zone & Navigate
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* CUSTOM LOGOUT MODAL */}
      <Modal
        visible={showLogoutModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowLogoutModal(false)}
      >
        <View style={styles.dutyModalOverlay}>
          <View style={styles.dutyModalCard}>
            <View style={styles.iconCircleRedCenter}>
              <Ionicons name="help-circle" size={32} color="#ef4444" />
            </View>
            <Text style={styles.dutyModalTitle}>Confirm Logout</Text>
            <Text style={styles.dutyModalMessage}>Do you want to logout?</Text>

            <View style={styles.modalInfoBoxRed}>
              <Text style={styles.modalInfoBoxTextRed}>
                ⚠️ You will be signed out of your account. You will need to log
                in again to access your partner dashboard.
              </Text>
            </View>

            <View style={styles.dutyButtonRow}>
              <TouchableOpacity
                style={styles.dutyCancelBtn}
                onPress={() => setShowLogoutModal(false)}
              >
                <Text style={styles.dutyCancelText}>No, Go Back</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalDangerBtn}
                disabled={loadingLogout}
                onPress={confirmLogoutAction}
              >
                {loadingLogout ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.modalDangerBtnText}>Yes, Logout</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* POLICY & AGREEMENTS VIEWER MODAL */}
      <PolicyViewerModal
        visible={policyModalVisible}
        title={policyTitle}
        htmlContent={policyHtml}
        loading={loadingPolicy}
        onClose={() => setPolicyModalVisible(false)}
        readOnly
      />
    </SafeAreaView>
  );
}

/* ================= STYLES ================= */

const styles = StyleSheet.create({
  container: { backgroundColor: "#fff" },
  header: {
    height: 72,
    paddingHorizontal: 20,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  logo: { width: 190, height: 64 },
  bellIcon: { position: "relative" },
  badge: {
    position: "absolute",
    top: -6,
    right: -10,
    backgroundColor: "#000",
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFD700", fontWeight: "800", fontSize: 12 },

  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
  },

  menu: {
    position: "absolute",
    top: 72,
    right: 20,
    backgroundColor: "#fff",
    borderRadius: 10,
    elevation: 6,
    width: 150,
    zIndex: 20,
  },

  menuItem: { padding: 14 },
  menuText: { fontSize: 15, fontWeight: "600" },

  sliderWrapper: {
    height: SLIDER_HEIGHT,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    borderRadius: 18,
    overflow: "hidden",
  },
  slideImage: { width: width - 32, height: SLIDER_HEIGHT },

  summaryRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    gap: 8,
    marginTop: 6,
  },
  summaryBox: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    backgroundColor: "#f9fafb",
    borderWidth: 1,
  },
  pendingBox: { borderColor: "#facc15" },
  assignedBox: { borderColor: "#f97316" },
  completedBox: { borderColor: "#16a34a" },
  cancelledBox: { borderColor: "#ef4444" },
  summaryTitle: { fontWeight: "600", marginBottom: 6, fontSize: 13 },
  summaryCount: { fontSize: 18, fontWeight: "800" },

  availabilityWrapper: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "#f9fafb",
    borderWidth: 1,
    borderColor: "#dae90b",
  },

  availabilityText: { fontSize: 16, fontWeight: "700" },

  customerCareWrapper: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 10,
  },

  customerCareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#000",
    backgroundColor: "#fff",
  },

  customerCareText: { fontSize: 14, fontWeight: "800" },

  fixedButtonWrapper: {
    paddingHorizontal: 40,
    paddingBottom: 10,
    backgroundColor: "#fff",
  },
  primaryBtn: {
    backgroundColor: "#FFD700",
    paddingVertical: 14,
    borderRadius: 18,
    alignItems: "center",
  },
  primaryBtnText: { fontWeight: "800", fontSize: 16 },

  dots: {
    position: "absolute",
    bottom: 10,
    width: "100%",
    flexDirection: "row",
    justifyContent: "center",
  },

  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#ccc",
    marginHorizontal: 4,
  },

  actionWrapper: {
    marginHorizontal: 16,
    marginTop: 12,
    gap: 10,
  },

  actionBtnRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },

  activeDot: { backgroundColor: "#000" },

  dutyModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  dutyModalCard: {
    width: "85%",
    backgroundColor: "#FFFBEB",
    borderColor: "#FFD700",
    borderWidth: 2,
    borderRadius: 24,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  dutyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#FFF3B0",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
  },
  dutyModalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
  },
  dutyModalMessage: {
    fontSize: 15,
    color: "#4B5563",
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
    fontWeight: "500",
  },
  dutyButtonRow: {
    flexDirection: "row",
    marginTop: 22,
    gap: 12,
    width: "100%",
  },
  dutyCancelBtn: {
    flex: 1,
    backgroundColor: "#E5E7EB",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },
  dutyCancelText: {
    color: "#374151",
    fontWeight: "700",
    fontSize: 15,
  },
  dutyConfirmBtn: {
    flex: 1,
    backgroundColor: "#FFD700",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },
  dutyConfirmText: {
    color: "#000000",
    fontWeight: "800",
    fontSize: 15,
  },

  sectionHeaderWrapper: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  sectionHeaderText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },
  dutyHoursRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    gap: 8,
    marginTop: 4,
    marginBottom: 6,
  },
  dutyHoursBox: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: "center",
    backgroundColor: "#FFFBEB",
    borderWidth: 1.5,
    borderColor: "#FFD700",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  dutyHoursTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4b5563",
    marginBottom: 4,
  },
  dutyHoursValue: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
  },

  availabilityCalendarBtn: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: "#FFD700",
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  availabilityCalendarBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#000",
  },

  draggableContainer: {
    position: "absolute",
    bottom: 24,
    right: 20,
    zIndex: 999,
    elevation: 10,
  },
  floatingZoneBtn: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 2,
    borderColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
    padding: 4,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  floatingBtnText: {
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 2,
  },
  zoneModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  zoneBackBtn: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: "#f3f4f6",
  },
  zoneModalHeaderTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },
  zoneModalHeaderSub: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: "500",
    marginTop: 1,
  },
  zoneHeaderStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  zoneAlertBanner: {
    position: "absolute",
    top: 10,
    left: 16,
    right: 16,
    backgroundColor: "#fef2f2",
    borderWidth: 1.5,
    borderColor: "#ef4444",
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
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
    fontWeight: "500",
  },
  zoneBottomCard: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  zoneCardLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#6b7280",
    letterSpacing: 0.5,
  },
  zoneCardHubName: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    marginTop: 2,
  },
  pincodesScrollView: {
    maxHeight: 56,
    marginVertical: 4,
  },
  zoneCardLocations: {
    fontSize: 13,
    color: "#4b5563",
    lineHeight: 18,
  },
  navigateBtn: {
    backgroundColor: "#FFD700",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#000000",
  },
  navigateBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#000000",
  },

  pincodeInfoCallout: {
    position: "absolute",
    top: 14,
    alignSelf: "center",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    borderWidth: 1.5,
    borderColor: "#0284c7",
    zIndex: 999,
  },
  pincodeInfoCalloutText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0f172a",
  },

  outOfZoneBanner: {
    backgroundColor: "#ef4444",
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  outOfZoneBannerTitle: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 14,
  },
  outOfZoneBannerSub: {
    color: "#ffffff",
    fontSize: 12,
    marginTop: 2,
  },

  boundsModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  boundsModalCard: {
    width: "100%",
    backgroundColor: "#FFFBEB",
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: "#FCD34D",
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 8,
  },
  boundsIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#FEF3C7",
    borderWidth: 2,
    borderColor: "#F59E0B",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  boundsModalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#78350F",
    textAlign: "center",
    marginBottom: 8,
  },
  boundsModalMessage: {
    fontSize: 14,
    color: "#92400E",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  boundsButtonColumn: {
    width: "100%",
    gap: 10,
  },
  boundsPrimaryBtn: {
    backgroundColor: "#FFD700",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    gap: 8,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  boundsPrimaryBtnText: {
    color: "#000000",
    fontWeight: "800",
    fontSize: 15,
  },
  boundsDismissBtn: {
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  boundsDismissText: {
    color: "#78350F",
    fontWeight: "600",
    fontSize: 14,
    textDecorationLine: "underline",
  },
  iconCircleRedCenter: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#fee2e2",
    borderWidth: 1.5,
    borderColor: "#fca5a5",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  modalInfoBoxRed: {
    width: "100%",
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fca5a5",
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
  },
  modalInfoBoxTextRed: {
    fontSize: 13,
    color: "#991b1b",
    lineHeight: 18,
  },
  modalDangerBtn: {
    flex: 1,
    backgroundColor: "#ef4444",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  modalDangerBtnText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 15,
  },

  headerGreeting: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },
  earningsCard: {
    backgroundColor: "#161618",
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 14,
    borderRadius: 20,
    padding: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  earningsCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  earningsCardLabel: {
    color: "#a1a1aa",
    fontSize: 15,
    fontWeight: "600",
  },
  chartIconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "rgba(255, 215, 0, 0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  earningsCardAmount: {
    color: "#ffffff",
    fontSize: 32,
    fontWeight: "900",
    marginVertical: 8,
    letterSpacing: 0.5,
  },
  earningsCardBottom: {
    flexDirection: "row",
    alignItems: "center",
  },
  earningsViewDetails: {
    color: "#FFD700",
    fontSize: 14,
    fontWeight: "700",
  },
  statusCardsRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    gap: 10,
    marginBottom: 16,
  },
  statusCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#f3f4f6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  statusIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FEF9C3",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  statusCount: {
    fontSize: 20,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 2,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#4b5563",
    textAlign: "center",
  },
  upcomingJobSection: {
    marginHorizontal: 16,
    marginBottom: 18,
  },
  upcomingJobHeader: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 10,
  },
  upcomingJobCard: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  upcomingJobTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  upcomingJobIconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#FEF9C3",
    justifyContent: "center",
    alignItems: "center",
  },
  upcomingJobTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },
  upcomingJobPayout: {
    fontSize: 14,
    fontWeight: "800",
    color: "#16a34a",
    marginTop: 2,
  },
  upcomingJobDateTime: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
    marginTop: 2,
  },
  upcomingJobAddressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
  },
  upcomingJobAddressText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    flex: 1,
  },
  upcomingJobBtn: {
    backgroundColor: "#FFD700",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 14,
  },
  upcomingJobBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#000000",
  },
  noJobCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 18,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  noJobIconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#FEF9C3",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 8,
  },
  noJobTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },
  noJobSub: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6b7280",
    textAlign: "center",
    marginTop: 4,
  },

  profileHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },

  profileInfoContainer: {
    justifyContent: "center",
    flex: 1,
  },

  headerDutyWrapper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8F8F8",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 8,
    flexShrink: 0,
  },

  headerDutyLabel: {
    fontSize: 15,
    fontWeight: "900",
    marginRight: 5,
    color: "#FFD700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});