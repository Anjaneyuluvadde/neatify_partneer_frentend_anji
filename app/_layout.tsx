import "../lib/locationTask";
import { Stack, usePathname, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Footer from "../components/Footer";
import GlobalChecklistListener from "../components/GlobalChecklistListener";

import {
  registerForPushNotificationsAsync,
  testLocalNotification,
  useNotificationListener,
} from "./notifications";

export default function Layout() {
  const pathname = usePathname();
  const router = useRouter();

  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const hideFooter = pathname === "/login" || keyboardVisible;

  /**
   * =========================================================
   * 🔔 NOTIFICATION LISTENER
   * =========================================================
   */
  useNotificationListener(router);

  /**
   * =========================================================
   * 🔔 PUSH REGISTRATION + KEYBOARD LISTENERS
   * =========================================================
   */
  useEffect(() => {
    registerForPushNotificationsAsync()
      .then(async (token) => {
        if (token) {
          try {
            await testLocalNotification();
          } catch (e) {
            console.log("Local notification test skipped", e);
          }
        }
      })
      .catch((error) => {
        console.log("Push registration error:", error);
      });

    const showSub = Keyboard.addListener("keyboardDidShow", () => {
      setKeyboardVisible(true);
    });

    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: "#fff",
      }}
      edges={["left", "right", "bottom"]}
    >
      <View style={{ flex: 1 }}>
        <GlobalChecklistListener />

        <Stack
          screenOptions={{
            animation: "none",
            gestureEnabled: true,
            gestureDirection: "horizontal",
            animationDuration: 250,
            headerShown: false,
          }}
        />
      </View>

      {!hideFooter && <Footer />}
    </SafeAreaView>
  );
}