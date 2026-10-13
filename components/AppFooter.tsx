import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";

export default function AppFooter() {
  const pathname = usePathname();

  const isActive = (path: string) => pathname === path;

  return (
    <View style={styles.footer}>
      <TouchableOpacity
        style={styles.item}
        onPress={() => router.replace("/my-role")}
      >
        <Ionicons
          name="home"
          size={22}
          color={isActive("/my-role") ? "#000" : "#111"}
        />
        <Text style={styles.text}>Home</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.item}>
        <Ionicons name="calendar-outline" size={22} color="#111" />
        <Text style={styles.text}>Dashboard</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.item}
        onPress={() => router.push("/my-account")}
      >
        <Ionicons
          name="person-outline"
          size={22}
          color={isActive("/my-account") ? "#dacbcb" : "#c9c2c2"}
        />
        <Text style={styles.text}>Profile</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    height: 64,
    backgroundColor: "#FFD700",
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  item: {
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
    color: "#000",
    marginTop: 4,
  },
});
