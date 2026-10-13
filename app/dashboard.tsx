import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useNavigation } from "@react-navigation/native";
import dayjs from "dayjs";
import isBetween from "dayjs/plugin/isBetween";
import isoWeek from "dayjs/plugin/isoWeek";
import { Image } from "expo-image";
import { router, usePathname } from "expo-router";
import { useEffect, useState } from "react";
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

dayjs.extend(isoWeek);
dayjs.extend(isBetween);

export default function Dashboard() {
  const pathname = usePathname();

  const [data, setData] = useState<any[]>([]);
  const [filterDate, setFilterDate] = useState("");
  const [sortBy, setSortBy] = useState<"recent" | "date" | "name">("recent");
  const [showSortOptions, setShowSortOptions] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);

  const [totalEarnings, setTotalEarnings] = useState(0);
  const [weeklyEarnings, setWeeklyEarnings] = useState(0);
  const [monthlyEarnings, setMonthlyEarnings] = useState(0);
  const [cancellationFee, setCancellationFee] = useState(0);
  const [pendingPaymentTotal, setPendingPaymentTotal] = useState(0);

  const [filter, setFilter] = useState("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const navigation = useNavigation();

  /* ================= LOAD COMPLETED SERVICES ================= */
  const loadCompleted = async (date?: string) => {
    try {
      let bookings: any[] = [];

      const response: any = await partnerApi.bookings("completed");
      const list = Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response)
        ? response
        : [];
      if (list.length > 0) {
        bookings = list;
      }

      // Filter by date if specified
      if (date) {
        bookings = bookings.filter((item) => {
          if (!item.work_ended_at) return false;
          return dayjs(item.work_ended_at).format("YYYY-MM-DD") === date;
        });
      }

      // Sort bookings
      if (sortBy === "recent") {
        bookings.sort(
          (a, b) =>
            new Date(b.work_ended_at || 0).getTime() -
            new Date(a.work_ended_at || 0).getTime()
        );
      } else if (sortBy === "date") {
        bookings.sort(
          (a, b) =>
            new Date(a.work_ended_at || 0).getTime() -
            new Date(b.work_ended_at || 0).getTime()
        );
      } else if (sortBy === "name") {
        bookings.sort((a, b) =>
          String(a.customer_name || "").localeCompare(String(b.customer_name || ""))
        );
      }

      setData(bookings);
    } catch (error: any) {
      console.error("Failed to load completed bookings:", error);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  /* ================= LOAD DASHBOARD SUMMARY ================= */
  const loadDashboardSummary = async () => {
    try {
      const response: any = await partnerApi.dashboard();
      const dashboard = response?.data || response;

      if (dashboard?.earnings) {
        setTotalEarnings(Number(dashboard.earnings.total || 0));
        setWeeklyEarnings(Number(dashboard.earnings.weekly || 0));
        setMonthlyEarnings(Number(dashboard.earnings.monthly || 0));
      }
    } catch (err) {
      console.log("Error loading dashboard summary:", err);
    }
  };

  /* ================= LOAD PENDING PAYMENTS ================= */
  const loadPendingPayments = async () => {
    try {
      const response: any = await partnerApi.pendingPayments();
      if (response?.total_pending !== undefined) {
        setPendingPaymentTotal(Number(response.total_pending || 0));
        return;
      }

      const pendingSum = data
        .filter((item) => item.payment_status?.toLowerCase() !== "paid")
        .reduce((sum, item) => sum + Number(item.staff_earned_amount || 0), 0);
      setPendingPaymentTotal(pendingSum);
    } catch (err) {
      console.log("Error loading pending payments:", err);
    }
  };

  /* ================= LOAD CANCELLATION FEE ================= */
  const loadCancellationFee = async () => {
    try {
      const response: any = await partnerApi.bookings("cancelled");
      const list = Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response)
        ? response
        : [];
      if (list.length > 0) {
        const total = list.reduce(
          (sum: number, item: any) => sum + Number(item.cancellation_fee || 0),
          0
        );
        setCancellationFee(total);
      } else {
        setCancellationFee(0);
      }
    } catch (err) {
      console.log("Error loading cancellation fee:", err);
      setCancellationFee(0);
    }
  };

  /* ================= INITIAL LOAD ================= */
  useEffect(() => {
    loadCompleted();
    loadDashboardSummary();
    loadPendingPayments();
    loadCancellationFee();
  }, []);

  useEffect(() => {
    loadCompleted(filterDate || undefined);
  }, [sortBy]);

  // Update pending calculation whenever data changes if not loaded via API
  useEffect(() => {
    if (pendingPaymentTotal === 0 && data.length > 0) {
      const pendingSum = data
        .filter((item) => item.payment_status?.toLowerCase() !== "paid")
        .reduce((sum, item) => sum + Number(item.staff_earned_amount || 0), 0);
      if (pendingSum > 0) {
        setPendingPaymentTotal(pendingSum);
      }
    }
  }, [data]);

  /* ================= REFRESH ================= */
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        loadCompleted(),
        loadDashboardSummary(),
        loadPendingPayments(),
        loadCancellationFee(),
      ]);
    } catch (err) {
      console.log("Refresh error:", err);
    } finally {
      setRefreshing(false);
    }
  };

  /* ================= FORMAT DATE ================= */
  const formatDateTime = (value: string) => {
    const d = new Date(value);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  };

  const filteredData = data.filter((item) => {
    const date = new Date(item.work_ended_at);
    const now = new Date();

    if (filter === "WEEKLY") {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(now.getDate() - 7);
      return date >= oneWeekAgo;
    }

    if (filter === "MONTHLY") {
      return (
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear()
      );
    }

    return true; // ALL
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
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
            router.canGoBack() ? router.back() : router.replace("/my-role")
          }
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={["#FFD700"]}
          />
        }
      >
        {/* ================= SERVICE PRICE CARDS BANNER ================= */}
        <View style={styles.priceCardBanner}>
          <View style={styles.priceCardBannerLeft}>
            <Text style={styles.priceCardBannerTitle}>View Service Price Cards</Text>
            <Text style={styles.priceCardBannerSubtitle}>
              Know your earnings for every service
            </Text>
          </View>
          <TouchableOpacity
            style={styles.priceCardBannerBtn}
            onPress={() => {
              router.push("/pricing-details");
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.priceCardBannerBtnText}>VIEW</Text>
          </TouchableOpacity>
        </View>

        {/* ================= SUMMARY STATS GRID ================= */}
        <View style={styles.summaryContainer}>
          <TouchableOpacity
            style={styles.gridBox}
            onPress={() => setFilter("ALL")}
            activeOpacity={0.85}
          >
            <Text style={styles.gridTitle}>Total Completed</Text>
            <Text style={styles.gridValue}>{data.length}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.gridBox}
            onPress={() => router.push("./total-earnings")}
            activeOpacity={0.85}
          >
            <Text style={styles.gridTitle}>Paid Earnings</Text>
            <Text style={styles.gridValue}>₹{totalEarnings}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.gridBox, styles.pendingGridBox]}
            onPress={() => router.push("./pending-payments")}
            activeOpacity={0.85}
          >
            <Text style={[styles.gridTitle, styles.pendingGridTitle]}>
              Pending Payments
            </Text>
            <Text style={[styles.gridValue, styles.pendingGridValue]}>
              ₹{pendingPaymentTotal}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.gridBox}
            onPress={() => router.push("/weekly-screen")}
            activeOpacity={0.85}
          >
            <Text style={styles.gridTitle}>Weekly</Text>
            <Text style={styles.gridValue}>₹{weeklyEarnings}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.gridBox}
            onPress={() => router.push("/monthly-screen")}
            activeOpacity={0.85}
          >
            <Text style={styles.gridTitle}>Monthly</Text>
            <Text style={styles.gridValue}>₹{monthlyEarnings}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.gridBox, styles.cancellationGridBox]}
            onPress={() => router.push("./cancellations")}
            activeOpacity={0.85}
          >
            <Text style={[styles.gridTitle, styles.cancellationGridTitle]}>
              Cancellation
            </Text>
            <Text style={[styles.gridValue, styles.cancellationGridValue]}>
              ₹{cancellationFee}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ================= FILTER ROW ================= */}
        <View style={styles.filterRow}>
          <View style={styles.filterBox}>
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", flex: 1 }}
              onPress={() => setShowCalendar(true)}
            >
              <Ionicons
                name="calendar-outline"
                size={20}
                color="#000"
                style={{ marginRight: 8 }}
              />

              <TextInput
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#6b7280"
                value={filterDate}
                keyboardType="number-pad"
                maxLength={10}
                onChangeText={(v) => {
                  const digits = v.replace(/[^0-9]/g, "");
                  let formatted = digits;

                  if (digits.length > 4) {
                    formatted = digits.slice(0, 4) + "-" + digits.slice(4);
                  }
                  if (digits.length > 6) {
                    formatted =
                      digits.slice(0, 4) +
                      "-" +
                      digits.slice(4, 6) +
                      "-" +
                      digits.slice(6, 8);
                  }

                  setFilterDate(formatted);
                  if (formatted.length === 10) loadCompleted(formatted);
                  if (formatted.length === 0) loadCompleted();
                }}
                style={styles.filterInput}
              />
            </TouchableOpacity>
          </View>

          <View style={{ marginLeft: 10 }}>
            <TouchableOpacity
              style={styles.sortBtn}
              onPress={() => setShowSortOptions(!showSortOptions)}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={styles.sortText}>
                  {sortBy === "recent"
                    ? "Recent"
                    : sortBy === "date"
                    ? "Oldest"
                    : "Name"}
                </Text>
                <Ionicons
                  name={showSortOptions ? "chevron-up" : "chevron-down"}
                  size={18}
                  color="#000"
                  style={{ marginLeft: 5 }}
                />
              </View>
            </TouchableOpacity>

            {showSortOptions && (
              <View style={styles.dropdown}>
                <TouchableOpacity
                  style={styles.dropdownItem}
                  onPress={() => {
                    setSortBy("recent");
                    setShowSortOptions(false);
                  }}
                >
                  <Text>Recent</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.dropdownItem}
                  onPress={() => {
                    setSortBy("date");
                    setShowSortOptions(false);
                  }}
                >
                  <Text>Oldest</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.dropdownItem}
                  onPress={() => {
                    setSortBy("name");
                    setShowSortOptions(false);
                  }}
                >
                  <Text>Name</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {showCalendar && (
          <DateTimePicker
            value={new Date()}
            mode="date"
            display="default"
            onChange={(event, selectedDate) => {
              setShowCalendar(false);
              if (selectedDate) {
                const year = selectedDate.getFullYear();
                const month = String(selectedDate.getMonth() + 1).padStart(2, "0");
                const day = String(selectedDate.getDate()).padStart(2, "0");

                const formatted = `${year}-${month}-${day}`;
                setFilterDate(formatted);
                loadCompleted(formatted);
              }
            }}
          />
        )}

        {/* ================= COMPLETED SERVICES CARDS ================= */}
        <View style={{ padding: 16 }}>
          {loading && !refreshing ? (
            <ActivityIndicator size="large" color="#FFD700" style={{ marginTop: 30 }} />
          ) : filteredData.length === 0 ? (
            <Text style={styles.empty}>No completed services</Text>
          ) : (
            filteredData.map((item, i) => (
              <View key={item.id || i} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.leftSection}>
                    <View style={styles.avatarCircle}>
                      <Ionicons name="person" size={24} color="#1B5E20" />
                    </View>

                    <View style={{ marginLeft: 10, flex: 1 }}>
                      <Text style={styles.customerLabel}>CUSTOMER NAME</Text>
                      <Text style={styles.name} numberOfLines={1}>
                        {item.customer_name || "Customer"}
                      </Text>
                    </View>
                  </View>

                  <Text
                    style={[
                      styles.completedBadge,
                      item.payment_status?.toLowerCase() === "paid"
                        ? styles.paidBadge
                        : styles.pendingBadge,
                    ]}
                  >
                    COMPLETED
                  </Text>
                </View>

                <View style={styles.bottomRow}>
                  <View>
                    <Text style={styles.dateLabel}>DATE</Text>
                    <Text style={styles.dateValue}>
                      {item.work_ended_at
                        ? dayjs(item.work_ended_at).format("DD MMM YYYY")
                        : "-"}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.amountText,
                      {
                        color:
                          item.payment_status?.toLowerCase() === "paid"
                            ? "#16a34a"
                            : "#f97316",
                      },
                    ]}
                  >
                    + ₹{Number(item.staff_earned_amount || 0)}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.viewBtn}
                  onPress={() => {
                    setSelectedItem(item);
                    setShowModal(true);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.viewText}>View Details →</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* ================= DETAILS MODAL ================= */}
      {showModal && selectedItem && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Service Details</Text>

            <Text style={styles.modalText}>
              Name: {selectedItem.customer_name || "Customer"}
            </Text>

            {selectedItem.email ? (
              <Text style={styles.modalText}>Email: {selectedItem.email}</Text>
            ) : null}

            {selectedItem.services && Array.isArray(selectedItem.services) ? (
              <View style={{ marginBottom: 6 }}>
                <Text style={styles.modalText}>Services:</Text>
                {selectedItem.services.map((s: any, idx: number) => (
                  <View key={idx} style={{ marginLeft: 10, marginTop: 3 }}>
                    <Text>• {s.title || s.name}</Text>
                    {s.duration ? (
                      <Text style={{ color: "#666", fontSize: 12 }}>
                        Duration: {s.duration}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            {selectedItem.work_ended_at ? (
              <Text style={styles.modalText}>
                Completed: {formatDateTime(selectedItem.work_ended_at)}
              </Text>
            ) : null}

            {selectedItem.worked_duration ? (
              <Text style={styles.modalText}>
                Worked Time: {selectedItem.worked_duration}
              </Text>
            ) : null}

            <Text style={styles.modalText}>
              Amount Earned: ₹{Number(selectedItem.staff_earned_amount || 0)}
            </Text>

            <Text style={styles.modalText}>
              Payment Status:{" "}
              <Text
                style={{
                  fontWeight: "700",
                  color:
                    selectedItem.payment_status?.toLowerCase() === "paid"
                      ? "#16a34a"
                      : "#f97316",
                }}
              >
                {(selectedItem.payment_status || "Pending").toUpperCase()}
              </Text>
            </Text>

            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => setShowModal(false)}
            >
              <Text style={{ color: "#000000", fontWeight: "700" }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

/* ================= STYLES ================= */

const styles = StyleSheet.create({
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
  priceCardBanner: {
    backgroundColor: "#FEFCE8",
    borderWidth: 1.5,
    borderColor: "#EAB308",
    borderRadius: 20,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  priceCardBannerLeft: {
    flex: 1,
    paddingRight: 12,
  },
  priceCardBannerTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#000000",
    marginBottom: 4,
  },
  priceCardBannerSubtitle: {
    fontSize: 13,
    fontWeight: "500",
    color: "#71717A",
  },
  priceCardBannerBtn: {
    backgroundColor: "#FFD700",
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  priceCardBannerBtnText: {
    color: "#000000",
    fontWeight: "800",
    fontSize: 14,
    letterSpacing: 0.5,
  },
  summaryContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginTop: 10,
  },
  gridBox: {
    width: "31%",
    backgroundColor: "#E6F4EA",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#A3D9A5",
    elevation: 3,
  },
  gridTitle: {
    fontSize: 13,
    color: "#2E7D32",
    marginBottom: 6,
  },
  gridValue: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1B5E20",
  },
  pendingGridBox: {
    backgroundColor: "#fff7ed",
    borderColor: "#fed7aa",
    borderWidth: 1.5,
  },
  pendingGridTitle: {
    color: "#c2410c",
  },
  pendingGridValue: {
    color: "#f97316",
  },
  cancellationGridBox: {
    backgroundColor: "#fef2f2",
    borderColor: "#fca5a5",
    borderWidth: 1.5,
  },
  cancellationGridTitle: {
    color: "#b91c1c",
  },
  cancellationGridValue: {
    color: "#dc2626",
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 10,
    zIndex: 1000,
  },
  filterBox: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
  filterInput: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
  },
  sortBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 12,
    borderColor: "#000",
    marginLeft: 10,
    backgroundColor: "#fff",
  },
  sortText: {
    fontWeight: "700",
  },
  dropdown: {
    position: "absolute",
    top: 50,
    right: 0,
    width: 120,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    elevation: 5,
    zIndex: 999,
  },
  dropdownItem: {
    padding: 10,
    borderBottomWidth: 0.5,
    borderColor: "#eee",
  },
  empty: {
    textAlign: "center",
    marginTop: 40,
    color: "#666",
    fontWeight: "600",
  },
  card: {
    borderWidth: 1.5,
    borderColor: "#b5ca42",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  leftSection: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  avatarCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#E8F5E9",
    justifyContent: "center",
    alignItems: "center",
  },
  customerLabel: {
    fontSize: 11,
    color: "#6B7280",
    fontWeight: "700",
    letterSpacing: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: "800",
    color: "#000",
    marginTop: 2,
  },
  completedBadge: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
  },
  paidBadge: {
    backgroundColor: "#dcfce7",
    color: "#16a34a",
  },
  pendingBadge: {
    backgroundColor: "#ffedd5",
    color: "#f97316",
  },
  bottomRow: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dateLabel: {
    fontSize: 11,
    color: "#6B7280",
    fontWeight: "700",
    letterSpacing: 1,
  },
  dateValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
    marginTop: 2,
  },
  amountText: {
    fontSize: 24,
    fontWeight: "900",
  },
  viewBtn: {
    marginTop: 12,
    alignSelf: "center",
    width: 180,
    height: 42,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#000",
    borderRadius: 24,
    backgroundColor: "#fff",
  },
  viewText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#000",
  },
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2000,
  },
  modalBox: {
    width: "85%",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 10,
  },
  modalText: {
    marginBottom: 6,
    color: "#333",
  },
  closeBtn: {
    marginTop: 15,
    backgroundColor: "#FFD700",
    padding: 10,
    borderRadius: 10,
    alignItems: "center",
  },
});