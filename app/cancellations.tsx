import { Ionicons } from "@expo/vector-icons";
import dayjs from "dayjs";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import * as Print from "expo-print";
import { useFocusEffect, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { partnerApi } from "../lib/api";

type CancelledBooking = {
  id: string;
  booking_id?: string;
  customer_name: string;
  services: any[];
  cancellation_fee: number;
  cancellation_reason: string;
  cancelled_at: string;
  booking_date: string;
};

export default function CancellationsScreen() {
  const router = useRouter();

  const [data, setData] = useState<CancelledBooking[]>([]);
  const [totalFee, setTotalFee] = useState(0);
  const [loading, setLoading] = useState(true);

  const [showCopySuccessModal, setShowCopySuccessModal] = useState(false);

  const fetchCancelledData = async () => {
    setLoading(true);

    try {
      let cancelledList: CancelledBooking[] = [];

      const response: any = await partnerApi.bookings("cancelled");
      const list = Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response)
        ? response
        : [];

      if (list.length > 0) {
        cancelledList = list.map((item: any) => ({
          id: item.id,
          booking_id: item.booking_id || item.id || "",
          customer_name: item.customer_name || "Customer",
          services: Array.isArray(item.services) ? item.services : [],
          cancellation_fee: Number(item.cancellation_fee || 0),
          cancellation_reason:
            item.cancellation_reason || item.reason || "Partner Cancelled",
          cancelled_at:
            item.cancelled_at ||
            item.work_ended_at ||
            item.booking_date ||
            new Date().toISOString(),
          booking_date: item.booking_date || "",
        }));
      }

      setData(cancelledList);
      const sum = cancelledList.reduce((acc, item) => acc + item.cancellation_fee, 0);
      setTotalFee(sum);
    } catch (err) {
      console.log("Error in fetchCancelledData:", err);
      setData([]);
      setTotalFee(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCancelledData();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchCancelledData();
    }, [])
  );

  const generatePDF = async () => {
    try {
      const rows = data
        .map(
          (item) => `
        <tr>
          <td>${item.customer_name}</td>
          <td>${item.cancellation_reason}</td>
          <td>₹${item.cancellation_fee}</td>
          <td>${dayjs(item.cancelled_at).format("DD MMM YYYY")}</td>
        </tr>
      `
        )
        .join("");

      const html = `
      <html>
        <body style="font-family: Arial; padding: 20px;">
          <h1 style="text-align:center; color: #b91c1c;">
            Cancellation Report
          </h1>

          <h2 style="color: #991b1b;">Total Cancellation Fee: ₹${totalFee}</h2>

          <table
            width="100%"
            border="1"
            cellspacing="0"
            cellpadding="8"
            style="border-collapse: collapse; margin-top: 20px;"
          >
            <thead>
              <tr style="background-color:#fee2e2; color: #991b1b;">
                <th>Customer</th>
                <th>Reason</th>
                <th>Fee Charged</th>
                <th>Date</th>
              </tr>
            </thead>

            <tbody>
              ${rows}
            </tbody>
          </table>
        </body>
      </html>
    `;

      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        dialogTitle: "Cancellation Report",
      });
    } catch (error) {
      console.log("PDF ERROR:", error);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* HEADER */}
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
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* TOTAL CANCELLATION FEE */}
        <Text style={styles.totalText}>Total Cancellation Fee: ₹{totalFee}</Text>

        {/* LIST */}
        {loading ? (
          <Text style={{ textAlign: "center", marginTop: 40 }}>Loading...</Text>
        ) : data.length === 0 ? (
          <Text style={{ textAlign: "center", marginTop: 40, color: "gray" }}>
            No cancelled services
          </Text>
        ) : (
          data.map((item, i) => (
            <View key={item.id || i} style={styles.card}>
              {/* Customer + Fee Row */}
              <View style={styles.cardRow}>
                <Text style={styles.customerName}>{item.customer_name}</Text>
                <Text style={styles.feeText}>Fee: ₹{item.cancellation_fee}</Text>
              </View>

              {/* Booking ID Box */}
              {item.booking_id ? (
                <View
                  style={{
                    backgroundColor: "#f3f4f6",
                    borderRadius: 10,
                    padding: 10,
                    marginTop: 10,
                    marginBottom: 10,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "700" }}>Booking ID:</Text>
                      <Text
                        numberOfLines={1}
                        style={{
                          marginTop: 4,
                          fontSize: 13,
                        }}
                      >
                        {item.booking_id}
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={() => {
                        Clipboard.setStringAsync(item.booking_id || "");
                        setShowCopySuccessModal(true);
                      }}
                    >
                      <Ionicons
                        name="copy-outline"
                        size={22}
                        color="#991b1b"
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}

              {item.services && item.services.length > 0 && (
                <View style={styles.servicesBox}>
                  {item.services.map((s: any, idx: number) => (
                    <Text key={idx} style={styles.serviceItem}>
                      • {s.title || s.name || s}
                    </Text>
                  ))}
                </View>
              )}

              <Text style={styles.reasonText}>
                <Text style={{ fontWeight: "700" }}>Reason:</Text>{" "}
                {item.cancellation_reason}
              </Text>

              <Text style={styles.dateText}>
                Cancelled on:{" "}
                {dayjs(item.cancelled_at).format("DD MMM YYYY, hh:mm A")}
              </Text>
            </View>
          ))
        )}
      </ScrollView>

      {data.length > 0 && (
        <TouchableOpacity
          style={styles.floatingDownloadBtn}
          onPress={generatePDF}
        >
          <Ionicons name="download-outline" size={26} color="#991b1b" />
          <Text style={styles.floatingDownloadText}>Download Report</Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={showCopySuccessModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCopySuccessModal(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "rgba(0,0,0,0.5)",
          }}
        >
          <View
            style={{
              width: "80%",
              backgroundColor: "#fff",
              borderRadius: 16,
              padding: 20,
              alignItems: "center",
            }}
          >
            <Ionicons name="checkmark-circle" size={50} color="#16a34a" />
            <Text
              style={{
                fontSize: 18,
                fontWeight: "700",
                marginTop: 10,
              }}
            >
              Copied Successfully
            </Text>
            <Text
              style={{
                textAlign: "center",
                color: "#6b7280",
                marginTop: 6,
              }}
            >
              Booking ID copied to clipboard.
            </Text>

            <TouchableOpacity
              style={{
                marginTop: 16,
                backgroundColor: "#FFD700",
                paddingHorizontal: 30,
                paddingVertical: 12,
                borderRadius: 10,
              }}
              onPress={() => setShowCopySuccessModal(false)}
            >
              <Text style={{ fontWeight: "700" }}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  logo: {
    width: 190,
    height: 64,
  },
  totalText: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#b91c1c",
  },
  card: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 14,
    marginTop: 12,
    borderWidth: 1.5,
    borderColor: "#fca5a5",
    elevation: 2,
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  customerName: {
    fontWeight: "800",
    fontSize: 16,
    color: "#111827",
    flex: 1,
  },
  feeText: {
    fontWeight: "800",
    fontSize: 16,
    color: "#dc2626",
  },
  servicesBox: {
    marginVertical: 4,
  },
  serviceItem: {
    fontSize: 13,
    color: "#4b5563",
  },
  reasonText: {
    fontSize: 14,
    color: "#991b1b",
    marginTop: 6,
  },
  dateText: {
    color: "gray",
    fontSize: 12,
    marginTop: 6,
  },
  floatingDownloadBtn: {
    position: "absolute",
    bottom: 90,
    right: 16,
    backgroundColor: "#fef2f2",
    borderWidth: 1.5,
    borderColor: "#fca5a5",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 30,
    elevation: 5,
  },
  floatingDownloadText: {
    marginLeft: 6,
    fontWeight: "700",
    color: "#991b1b",
    fontSize: 13,
  },
});