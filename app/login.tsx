import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as LocalAuthentication from "expo-local-authentication";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import RenderHtml from "react-native-render-html";
import { authApi, clearAuthTokens, getAccessToken, partnerApi } from "../lib/api";
import { scheduleDailyDutyReminders } from "../lib/dutyReminders";
import { supabase } from "../lib/supabase";
import { registerForPushNotificationsAsync } from "./notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function LoginScreen() {
  const { width } = useWindowDimensions();

  // Navigation state: "welcome" or "email"
  const [viewState, setViewState] = useState<"welcome" | "email">("welcome");

  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Session states
  const [sessionExists, setSessionExists] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  // Policy & Consent states
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [modalTermsAccepted, setModalTermsAccepted] = useState(false);
  const [modalPrivacyAccepted, setModalPrivacyAccepted] = useState(false);
  const [policyContent, setPolicyContent] = useState("");
  const [termsContent, setTermsContent] = useState("");
  const [viewerModalTitle, setViewerModalTitle] = useState("");
  const [viewerModalContent, setViewerModalContent] = useState("");
  const [showViewerModal, setShowViewerModal] = useState(false);

  // Alert modal
  const [alertModal, setAlertModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    isBlocked?: boolean;
  }>({
    visible: false,
    title: "",
    message: "",
    isBlocked: false,
  });

  const showAlert = (title: string, message: string, isBlocked: boolean = false) => {
    setAlertModal({
      visible: true,
      title,
      message,
      isBlocked,
    });
  };

  useEffect(() => {
    checkSession();
    loadPolicies();
  }, []);

  // Hardware back press handler
  useEffect(() => {
    const backAction = () => {
      if (viewState === "email") {
        setViewState("welcome");
        return true;
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);
    return () => backHandler.remove();
  }, [viewState]);

  const loadPolicies = async () => {
    try {
      const response = await partnerApi.getPolicies();
      setPolicyContent(response?.user_policies || "");
      setTermsContent(response?.terms_and_conditions || "");
    } catch (error) {
      console.log("Failed loading policies:", error);
    }
  };

  const checkSession = async () => {
    try {
      setCheckingSession(true);
      const token = await getAccessToken();
      if (!token) {
        setSessionExists(false);
        return;
      }

      try {
        const currentUser = await authApi.me();
        console.log("✅ Existing backend session:", currentUser.id, currentUser.email);
        setSessionExists(true);
      } catch {
        console.log("⚠️ Backend session invalid or expired");
        await clearAuthTokens();
        setSessionExists(false);
      }
    } catch {
      setSessionExists(false);
    } finally {
      setCheckingSession(false);
    }
  };

  const isAuthenticatingRef = useRef(false);

  const verifyDeviceSecurity = async () => {
    if (isAuthenticatingRef.current) return true;
    isAuthenticatingRef.current = true;
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) return true;

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Neatify Partner",
      });
      return result.success;
    } catch {
      return true;
    } finally {
      isAuthenticatingRef.current = false;
    }
  };

  const handleLogin = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      showAlert("Error", "Email and password are required.");
      return;
    }

    setLoading(true);

    try {
      // 1. Authenticate through Node/FastAPI backend
      const authResponse = await authApi.login(cleanEmail, password);
      console.log("✅ API login successful:", authResponse.token_type);

      // 2. Also authenticate with Supabase companion session (safe fallback)
      try {
        await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: password,
        });
      } catch (se) {
        console.log("Supabase sync sign-in note:", se);
      }

      // 3. Verify user
      const currentUser = await authApi.me();
      console.log("✅ Logged in partner:", currentUser.id, currentUser.email);

      // 4. Check policy consent
      try {
        const policyStatus = await partnerApi.getPolicyStatus();
        const accepted = policyStatus?.terms_accepted && policyStatus?.privacy_policy_accepted;
        if (!accepted) {
          setShowConsentModal(true);
          return;
        }
      } catch (pe) {
        console.log("Policy check warning:", pe);
      }

      // 5. Biometric security check
      const verified = await verifyDeviceSecurity();
      if (!verified) {
        try {
          await authApi.logout();
        } catch {}
        showAlert("Verification Failed", "Device authentication failed.");
        return;
      }

      // 6. Push notification token
      try {
        const pushToken = await registerForPushNotificationsAsync();
        if (pushToken) {
          await partnerApi.updatePushToken(pushToken);
        }
      } catch (pErr) {
        console.log("Push token registration error:", pErr);
      }

      // 7. Schedule daily reminders
      try {
        await scheduleDailyDutyReminders();
      } catch {}

      // 8. Navigate to partner home
      router.replace("./my-role");
    } catch (err: any) {
      console.error("❌ Login error:", err);
      showAlert("Login Failed", err?.message || "Invalid email or password.");
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptPolicies = async () => {
    try {
      setLoading(true);
      await partnerApi.acceptPolicies();
      setShowConsentModal(false);
      router.replace("./my-role");
    } catch {
      showAlert("Error", "Unable to save consent. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async () => {
    if (loading) return;
    setLoading(true);

    try {
      await authApi.me();
      const verified = await verifyDeviceSecurity();
      if (verified) {
        router.replace("./my-role");
      } else {
        showAlert("Verification Failed", "Device authentication failed.");
      }
    } catch {
      await clearAuthTokens();
      setSessionExists(false);
      showAlert("Session Expired", "Please log in again.");
    } finally {
      setLoading(false);
    }
  };

  const openTermsViewer = () => {
    setViewerModalTitle("Terms & Conditions");
    setViewerModalContent(
      termsContent ||
        "<h3>Terms & Conditions</h3><p>By using The Neatify Team Partner App, you agree to follow the partner operational guidelines, maintain service excellence, and comply with location and duty tracking requirements.</p>"
    );
    setShowViewerModal(true);
  };

  const openPrivacyViewer = () => {
    setViewerModalTitle("Privacy Policy");
    setViewerModalContent(
      policyContent ||
        "<h3>Privacy Policy</h3><p>We respect your privacy. Location and device information is gathered exclusively during active on-duty sessions to coordinate cleaning tasks and ensure customer safety.</p>"
    );
    setShowViewerModal(true);
  };

  // Loading indicator while checking existing session
  if (checkingSession) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#FFC700" />
      </View>
    );
  }

  // Quick Unlock Screen for already authenticated partners
  if (sessionExists && !loading) {
    return (
      <SafeAreaView style={styles.unlockContainer}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
        <Image
          source={require("../assets/images/logo.png")}
          style={styles.unlockLogo}
          contentFit="contain"
        />
        <Text style={styles.unlockTitle}>Welcome Back</Text>
        <Text style={styles.unlockSub}>Unlock your partner account to continue</Text>

        <TouchableOpacity style={styles.primaryBtn} onPress={handleUnlock} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryBtnText}>Unlock Account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.switchAccountBtn}
          onPress={async () => {
            await clearAuthTokens();
            try {
              await supabase.auth.signOut();
            } catch {}
            setSessionExists(false);
            setViewState("welcome");
          }}
        >
          <Text style={styles.switchAccountText}>Log in as different partner</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* ========================================================
          SCREEN 1: WELCOME SCREEN (Matching User Screenshot 1)
          ======================================================== */}
      {viewState === "welcome" && (
        <ScrollView
          contentContainerStyle={styles.welcomeScroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Logo & Slogan */}
          <View style={styles.topHeader}>
            <Image
              source={require("../assets/images/logo.png")}
              style={styles.brandLogo}
              contentFit="contain"
            />
            <Text style={styles.brandTagline}>Clean Spaces</Text>
            <Text style={styles.brandSubtitle}>Happier Lives</Text>
          </View>

          {/* Hero Illustration: 2 Cleaners in Uniform */}
          <View style={styles.heroContainer}>
            <Image
              source={require("../assets/images/partner_cleaners_hero.jpg")}
              style={styles.cleanersHeroImage}
              contentFit="contain"
            />
          </View>

          {/* Welcome Info & Actions */}
          <View style={styles.welcomeContent}>
            <View style={styles.partnerBadge}>
              <Text style={styles.partnerBadgeText}>PARTNER APP</Text>
            </View>

            <Text style={styles.welcomeTitle}>Welcome Partner</Text>
            <Text style={styles.welcomeDescription}>
              Become part of India's fastest-growing professional cleaning network.
            </Text>

            {/* Login with Email Button */}
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => setViewState("email")}
              activeOpacity={0.85}
            >
              <Ionicons name="mail" size={20} color="#000000" style={{ marginRight: 8 }} />
              <Text style={styles.primaryBtnText}>Login with Email</Text>
            </TouchableOpacity>

            {/* Footer Legal Terms */}
            <View style={styles.legalFooter}>
              <Text style={styles.legalPrefix}>By continuing, you agree to our</Text>
              <View style={styles.legalLinksRow}>
                <TouchableOpacity onPress={openTermsViewer}>
                  <Text style={styles.legalLink}>Terms & Conditions</Text>
                </TouchableOpacity>
                <Text style={styles.legalDivider}> | </Text>
                <TouchableOpacity onPress={openPrivacyViewer}>
                  <Text style={styles.legalLink}>Privacy Policy</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.poweredByText}>
                Powered by The Neatify Services (OPC) Pvt. Ltd.
              </Text>
            </View>
          </View>
        </ScrollView>
      )}

      {/* ========================================================
          SCREEN 2: LOGIN WITH EMAIL (Matching User Screenshot 2)
          ======================================================== */}
      {viewState === "email" && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.emailScroll}
            showsVerticalScrollIndicator={false}
          >
            {/* Top Navigation Row */}
            <View style={styles.emailNavRow}>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => setViewState("welcome")}
                activeOpacity={0.7}
              >
                <Ionicons name="arrow-back" size={24} color="#000000" />
              </TouchableOpacity>

              <Image
                source={require("../assets/images/logo.png")}
                style={styles.miniLogo}
                contentFit="contain"
              />
            </View>

            {/* Title & Subtitle */}
            <View style={styles.emailHeader}>
              <Text style={styles.emailTitle}>Login with Email</Text>
              <Text style={styles.emailSubtitle}>Access your partner account securely.</Text>
            </View>

            {/* Illustration: Female cleaner wiping window */}
            <View style={styles.wipingIllustrationContainer}>
              <Image
                source={require("../assets/images/cleaner_wiping.jpg")}
                style={styles.wipingHeroImage}
                contentFit="contain"
              />
            </View>

            {/* Login Form Fields */}
            <View style={styles.formContainer}>
              {/* Email Address Field */}
              <Text style={styles.fieldLabel}>EMAIL ADDRESS</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="mail-outline" size={20} color="#6B7280" style={styles.inputIcon} />
                <TextInput
                  placeholder="name@example.com"
                  placeholderTextColor="#9CA3AF"
                  style={styles.input}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  selectionColor="#FFC700"
                />
              </View>

              {/* Password Field */}
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <View style={styles.inputContainer}>
                <Ionicons
                  name="lock-closed-outline"
                  size={20}
                  color="#6B7280"
                  style={styles.inputIcon}
                />
                <TextInput
                  placeholder="••••••••"
                  placeholderTextColor="#9CA3AF"
                  style={styles.input}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  selectionColor="#FFC700"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  style={styles.eyeBtn}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={22}
                    color="#6B7280"
                  />
                </TouchableOpacity>
              </View>

              {/* Log In Button */}
              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 24 }]}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading ? (
                  <ActivityIndicator color="#000000" />
                ) : (
                  <Text style={styles.primaryBtnText}>Log In</Text>
                )}
              </TouchableOpacity>

              {/* Footer Legal Terms */}
              <View style={[styles.legalFooter, { marginTop: 24 }]}>
                <Text style={styles.legalPrefix}>By continuing, you agree to our</Text>
                <View style={styles.legalLinksRow}>
                  <TouchableOpacity onPress={openTermsViewer}>
                    <Text style={styles.legalLink}>Terms & Conditions</Text>
                  </TouchableOpacity>
                  <Text style={styles.legalDivider}> | </Text>
                  <TouchableOpacity onPress={openPrivacyViewer}>
                    <Text style={styles.legalLink}>Privacy Policy</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ========================================================
          POLICY VIEWER MODAL (HTML Viewer)
          ======================================================== */}
      <Modal
        visible={showViewerModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowViewerModal(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalHeaderTitle}>{viewerModalTitle}</Text>
            <TouchableOpacity
              onPress={() => setShowViewerModal(false)}
              style={styles.modalCloseBtn}
            >
              <Ionicons name="close" size={24} color="#000" />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1, padding: 20 }}>
            <RenderHtml
              contentWidth={width - 40}
              source={{ html: viewerModalContent || "<p>No content available.</p>" }}
            />
            <View style={{ height: 40 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ========================================================
          POLICY CONSENT MODAL (First time login)
          ======================================================== */}
      <Modal visible={showConsentModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.consentCard}>
            <Text style={styles.consentTitle}>Partner Agreements</Text>
            <Text style={styles.consentSubtitle}>
              Please review and accept our partner terms and privacy policy before continuing.
            </Text>

            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setModalTermsAccepted(!modalTermsAccepted)}
            >
              <Ionicons
                name={modalTermsAccepted ? "checkbox" : "square-outline"}
                size={22}
                color={modalTermsAccepted ? "#16A34A" : "#6B7280"}
              />
              <Text style={styles.checkboxLabel}>I accept the Terms & Conditions</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.checkboxRow}
              onPress={() => setModalPrivacyAccepted(!modalPrivacyAccepted)}
            >
              <Ionicons
                name={modalPrivacyAccepted ? "checkbox" : "square-outline"}
                size={22}
                color={modalPrivacyAccepted ? "#16A34A" : "#6B7280"}
              />
              <Text style={styles.checkboxLabel}>I accept the Privacy Policy</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.primaryBtn,
                {
                  marginTop: 16,
                  opacity: modalTermsAccepted && modalPrivacyAccepted ? 1 : 0.5,
                },
              ]}
              disabled={!modalTermsAccepted || !modalPrivacyAccepted || loading}
              onPress={handleAcceptPolicies}
            >
              {loading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.primaryBtnText}>Agree & Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ========================================================
          ALERT / ERROR MODAL
          ======================================================== */}
      <Modal visible={alertModal.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.alertCard}>
            <View
              style={[
                styles.alertIconCircle,
                { backgroundColor: alertModal.isBlocked ? "#FEE2E2" : "#FEF3C7" },
              ]}
            >
              <Ionicons
                name={alertModal.isBlocked ? "alert-circle" : "information-circle"}
                size={30}
                color={alertModal.isBlocked ? "#DC2626" : "#D97706"}
              />
            </View>

            <Text style={styles.alertTitle}>{alertModal.title}</Text>
            <Text style={styles.alertMessage}>{alertModal.message}</Text>

            <TouchableOpacity
              style={styles.alertBtn}
              onPress={() => setAlertModal({ visible: false, title: "", message: "" })}
            >
              <Text style={styles.alertBtnText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loaderContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  unlockContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    backgroundColor: "#FFFFFF",
  },
  unlockLogo: {
    width: 220,
    height: 90,
    marginBottom: 20,
  },
  unlockTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
  },
  unlockSub: {
    fontSize: 14,
    color: "#6B7280",
    marginBottom: 28,
    textAlign: "center",
  },
  switchAccountBtn: {
    marginTop: 20,
    paddingVertical: 10,
  },
  switchAccountText: {
    fontSize: 14,
    color: "#4B5563",
    fontWeight: "600",
  },

  /* SCREEN 1: WELCOME */
  welcomeScroll: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 28,
    backgroundColor: "#FFFFFF",
  },
  topHeader: {
    alignItems: "center",
    marginBottom: 6,
  },
  brandLogo: {
    width: 140,
    height: 60,
    marginBottom: 6,
  },
  brandTagline: {
    fontSize: 22,
    fontWeight: "900",
    color: "#111827",
    letterSpacing: -0.5,
  },
  brandSubtitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#4B5563",
    marginTop: 2,
  },
  heroContainer: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 12,
  },
  cleanersHeroImage: {
    width: "100%",
    height: 290,
  },
  welcomeContent: {
    width: "100%",
    alignItems: "center",
  },
  partnerBadge: {
    backgroundColor: "#FEF9C3",
    borderWidth: 1,
    borderColor: "#FDE047",
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 10,
  },
  partnerBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#854D0E",
    letterSpacing: 1,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: "#111827",
    textAlign: "center",
    marginBottom: 8,
  },
  welcomeDescription: {
    fontSize: 13.5,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 22,
    paddingHorizontal: 16,
  },

  /* SCREEN 2: EMAIL LOGIN */
  emailScroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    backgroundColor: "#FFFFFF",
  },
  emailNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },
  miniLogo: {
    width: 120,
    height: 48,
  },
  emailHeader: {
    marginBottom: 10,
  },
  emailTitle: {
    fontSize: 26,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 4,
  },
  emailSubtitle: {
    fontSize: 14,
    color: "#6B7280",
  },
  wipingIllustrationContainer: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 8,
  },
  wipingHeroImage: {
    width: "100%",
    height: 220,
  },
  formContainer: {
    width: "100%",
    marginTop: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: "#374151",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 14,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F9FAFB",
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    height: 54,
    paddingHorizontal: 14,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: "#111827",
    fontWeight: "500",
  },
  eyeBtn: {
    padding: 6,
  },

  /* BUTTONS & FOOTER */
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFC700",
    height: 52,
    borderRadius: 14,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },
  legalFooter: {
    alignItems: "center",
    marginTop: 22,
  },
  legalPrefix: {
    fontSize: 12,
    color: "#6B7280",
    marginBottom: 4,
  },
  legalLinksRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  legalLink: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#111827",
    textDecorationLine: "underline",
  },
  legalDivider: {
    fontSize: 12,
    color: "#9CA3AF",
  },
  poweredByText: {
    fontSize: 11,
    color: "#9CA3AF",
  },

  /* MODALS */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
  },
  modalHeaderTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
  },
  modalCloseBtn: {
    padding: 4,
  },
  consentCard: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  consentTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
  },
  consentSubtitle: {
    fontSize: 13.5,
    color: "#6B7280",
    marginBottom: 20,
    lineHeight: 20,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    paddingVertical: 4,
  },
  checkboxLabel: {
    fontSize: 14,
    color: "#1F2937",
    marginLeft: 10,
    fontWeight: "500",
  },
  alertCard: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
  },
  alertIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  alertTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
    textAlign: "center",
  },
  alertMessage: {
    fontSize: 14,
    color: "#4B5563",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  alertBtn: {
    width: "100%",
    height: 48,
    backgroundColor: "#111827",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  alertBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15,
  },
});
