import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface ConsentModalProps {
  visible: boolean;
  privacyChecked: boolean;
  setPrivacyChecked: (val: boolean) => void;
  termsChecked: boolean;
  setTermsChecked: (val: boolean) => void;
  onOpenPrivacyPolicy: () => void;
  onOpenTerms: () => void;
  onAccept: () => void;
  onClose: () => void;
  loading?: boolean;
}

export default function ConsentModal({
  visible,
  privacyChecked,
  setPrivacyChecked,
  termsChecked,
  setTermsChecked,
  onOpenPrivacyPolicy,
  onOpenTerms,
  onAccept,
  onClose,
  loading = false,
}: ConsentModalProps) {
  const isAllAccepted = privacyChecked && termsChecked;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Top Close Button (X) */}
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={22} color="#6b7280" />
          </TouchableOpacity>

          {/* Icon Header */}
          <View style={styles.iconCircle}>
            <Ionicons name="document-text" size={30} color="#000" />
          </View>

          {/* Title & Description */}
          <Text style={styles.title}>Consent Required</Text>
          <Text style={styles.message}>
            To continue using <Text style={styles.appName}>The Neatify Team Partner App</Text>, please review and accept our Privacy Policy and Terms & Conditions. Acceptance is mandatory to access partner features.
          </Text>

          {/* Checkbox Rows */}
          <View style={styles.checkboxContainer}>
            {/* Privacy Policy Checkbox Row */}
            <View style={styles.checkboxRow}>
              <TouchableOpacity
                style={styles.checkboxTouch}
                onPress={() => setPrivacyChecked(!privacyChecked)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={privacyChecked ? "checkbox" : "square-outline"}
                  size={24}
                  color={privacyChecked ? "#2563eb" : "#9ca3af"}
                />
              </TouchableOpacity>
              <Text style={styles.checkboxLabel}>
                I agree to the{" "}
                <Text
                  style={styles.linkText}
                  onPress={onOpenPrivacyPolicy}
                >
                  Privacy Policy
                </Text>
              </Text>
            </View>

            {/* Terms & Conditions Checkbox Row */}
            <View style={styles.checkboxRow}>
              <TouchableOpacity
                style={styles.checkboxTouch}
                onPress={() => setTermsChecked(!termsChecked)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={termsChecked ? "checkbox" : "square-outline"}
                  size={24}
                  color={termsChecked ? "#2563eb" : "#9ca3af"}
                />
              </TouchableOpacity>
              <Text style={styles.checkboxLabel}>
                I agree to the{" "}
                <Text
                  style={styles.linkText}
                  onPress={onOpenTerms}
                >
                  Terms & Conditions
                </Text>
              </Text>
            </View>
          </View>

          {/* Accept & Continue Button */}
          <TouchableOpacity
            style={[
              styles.acceptBtn,
              isAllAccepted ? styles.acceptBtnEnabled : styles.acceptBtnDisabled,
            ]}
            onPress={onAccept}
            disabled={!isAllAccepted || loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#000000" size="small" />
            ) : (
              <Text
                style={[
                  styles.acceptBtnText,
                  isAllAccepted
                    ? styles.acceptBtnTextEnabled
                    : styles.acceptBtnTextDisabled,
                ]}
              >
                Accept & Continue
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "92%",
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 22,
    alignItems: "center",
    position: "relative",
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  closeBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    padding: 6,
    borderRadius: 16,
    backgroundColor: "#f3f4f6",
    zIndex: 10,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFF3B0",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
    marginTop: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
  },
  appName: {
    fontWeight: "700",
    color: "#111827",
  },
  message: {
    fontSize: 13.5,
    color: "#4b5563",
    textAlign: "center",
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 20,
  },
  checkboxContainer: {
    width: "100%",
    backgroundColor: "#f8fafc",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    gap: 12,
    marginBottom: 20,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  checkboxTouch: {
    paddingRight: 10,
  },
  checkboxLabel: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "600",
    flex: 1,
  },
  linkText: {
    color: "#2563eb",
    textDecorationLine: "underline",
    fontWeight: "700",
  },
  acceptBtn: {
    width: "100%",
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptBtnEnabled: {
    backgroundColor: "#FFD700",
  },
  acceptBtnDisabled: {
    backgroundColor: "#e2e8f0",
  },
  acceptBtnText: {
    fontSize: 16,
    fontWeight: "800",
  },
  acceptBtnTextEnabled: {
    color: "#000000",
  },
  acceptBtnTextDisabled: {
    color: "#94a3b8",
  },
});
