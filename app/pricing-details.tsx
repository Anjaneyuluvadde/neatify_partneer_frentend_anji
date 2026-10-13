import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { partnerApi } from "../lib/api";

interface ServicePricingItem {
  id?: string;
  title: string;
  staff_amount?: number | string | null;
}

export default function PricingDetailsScreen() {
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchPricingDetails = async () => {
    try {
      const response: any = await partnerApi.pricingCards();
      const list = Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response)
        ? response
        : [];

      if (list.length > 0) {
        const sorted = [...list].sort((a, b) => {
          const titleA = (a.title || a.name || a.service_name || "").toLowerCase();
          const titleB = (b.title || b.name || b.service_name || "").toLowerCase();
          return titleA.localeCompare(titleB);
        });

        setServices(sorted);
      } else {
        setServices([]);
      }
    } catch (err) {
      console.error("Error fetching pricing from backend API:", err);
      setServices([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPricingDetails();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchPricingDetails();
  };

  const getServiceTitle = (item: any) => {
    return item.title || item.name || item.service_name || "Service";
  };

  const formatAmount = (item: any) => {
    // 1. Get raw staff_amount value from item or check case-insensitive variations
    let rawVal = item?.staff_amount;

    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === "") {
      const key = Object.keys(item || {}).find(
        (k) =>
          k.toLowerCase() === "staff_amount" ||
          k.toLowerCase().includes("staff_amount") ||
          k.toLowerCase().includes("staffamount")
      );
      if (key) {
        rawVal = item[key];
      }
    }

    // Fallbacks if staff_amount is not present in row
    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === "") {
      rawVal = item?.partner_amount ?? item?.amount ?? item?.price;
    }

    if (rawVal === null || rawVal === undefined) return "-";

    const strVal = String(rawVal).trim();
    if (
      !strVal ||
      strVal.toLowerCase() === "null" ||
      strVal.toLowerCase() === "undefined"
    ) {
      return "-";
    }

    // 2. Remove Mojibake encoding corruption
    const sanitized = strVal
      .replace(/[â\u00e2\u201a\u00b9^]/g, "")
      .replace(/^[,.\s]+/, "")
      .trim();

    // 3. Extract purely numeric values and decimals
    const cleanedDigits = strVal.replace(/[^0-9.]/g, "");
    if (cleanedDigits) {
      const num = parseFloat(cleanedDigits);
      if (!isNaN(num)) {
        const parts = cleanedDigits.split(".");
        if (parts.length > 1 && parts[1] !== "0" && parts[1] !== "00") {
          const decCount = Math.min(parts[1].length, 2);
          return `₹${num.toLocaleString("en-IN", {
            minimumFractionDigits: decCount,
            maximumFractionDigits: decCount,
          })}`;
        }
        return `₹${Math.round(num).toLocaleString("en-IN")}`;
      }
    }

    // 4. Return sanitized string if no valid digits were found
    return sanitized || "-";
  };

  const filteredServices = services.filter((item) =>
    getServiceTitle(item).toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  return (
    <SafeAreaView style={styles.safeContainer}>
      <StatusBar backgroundColor="#FFD700" barStyle="dark-content" />

      {/* ================= HEADER ================= */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace("/my-role")}>
          <Image
            source={require("../assets/images/logo.png")}
            style={styles.logo}
            contentFit="contain"
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/dashboard")
          }
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color="#000000" />
        </TouchableOpacity>
      </View>

      {/* ================= TITLE BANNER & SEARCH ================= */}
      <View style={styles.bannerContainer}>
        <View style={styles.bannerHeaderRow}>
          <Text style={styles.screenTitle}>Pricing Details</Text>
          <View style={styles.badgeCount}>
            <Text style={styles.badgeCountText}>
              {filteredServices.length} {filteredServices.length === 1 ? "Service" : "Services"}
            </Text>
          </View>
        </View>

        {/* Search Bar */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color="#6b7280" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search service name..."
            placeholderTextColor="#9ca3af"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={18} color="#9ca3af" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* ================= TABLE CONTENT ================= */}
      <View style={styles.tableCard}>
        {/* Table Column Headers */}
        <View style={styles.tableHeaderRow}>
          <Text style={styles.colHeaderIndex}>#</Text>
          <Text style={styles.colHeaderTitle}>Service</Text>
          <Text style={styles.colHeaderAmount}>Amount</Text>
        </View>

        {loading && !refreshing ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#FFD700" />
            <Text style={styles.loadingText}>Loading pricing rates...</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollList}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={true}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={["#FFD700"]} />
            }
          >
            {filteredServices.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="document-text-outline" size={44} color="#d1d5db" />
                <Text style={styles.emptyText}>
                  {searchQuery ? "No matching services found." : "No pricing details available."}
                </Text>
              </View>
            ) : (
              filteredServices.map((item, index) => {
                const formattedAmt = formatAmount(item);
                const title = getServiceTitle(item);
                const hasAmount = formattedAmt !== "-";
                const isEven = index % 2 === 0;

                return (
                  <View
                    key={item.id || index.toString()}
                    style={[styles.tableRow, isEven ? styles.rowEven : styles.rowOdd]}
                  >
                    {/* Index Number */}
                    <View style={styles.indexCell}>
                      <Text style={styles.indexText}>{index + 1}</Text>
                    </View>

                    {/* Service Name */}
                    <View style={styles.titleCell}>
                      <Text style={styles.serviceTitle}>{title}</Text>
                    </View>

                    {/* Partner Amount */}
                    <View style={styles.amountCell}>
                      <Text
                        style={[
                          styles.amountText,
                          hasAmount ? styles.amountTextActive : styles.amountTextEmpty,
                        ]}
                      >
                        {formattedAmt}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  header: {
    height: 72,
    paddingHorizontal: 20,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  logo: {
    width: 190,
    height: 64,
  },
  bannerContainer: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  bannerHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#111827",
  },
  badgeCount: {
    backgroundColor: "#FEF9C3",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#FDE047",
  },
  badgeCountText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#854D0E",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 44,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
    fontWeight: "500",
  },
  tableCard: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 16,
    backgroundColor: "#ffffff",
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  tableHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEFCE8",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderBottomColor: "#FACC15",
  },
  colHeaderIndex: {
    width: 36,
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
  },
  colHeaderTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    paddingLeft: 8,
  },
  colHeaderAmount: {
    width: 100,
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
    textAlign: "right",
  },
  scrollList: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  rowEven: {
    backgroundColor: "#ffffff",
  },
  rowOdd: {
    backgroundColor: "#FAFAFA",
  },
  indexCell: {
    width: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  indexText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#4B5563",
  },
  titleCell: {
    flex: 1,
    paddingLeft: 8,
    paddingRight: 10,
  },
  serviceTitle: {
    fontSize: 14.5,
    fontWeight: "600",
    color: "#1F2937",
    lineHeight: 20,
  },
  amountCell: {
    width: 100,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  amountText: {
    fontSize: 15,
    fontWeight: "800",
  },
  amountTextActive: {
    color: "#16a34a",
  },
  amountTextEmpty: {
    color: "#9ca3af",
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "600",
  },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 14,
    color: "#9ca3af",
    fontWeight: "600",
    textAlign: "center",
  },
});