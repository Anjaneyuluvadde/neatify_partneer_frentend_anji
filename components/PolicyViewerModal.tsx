import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import RenderHtml from "react-native-render-html";

interface PolicyViewerModalProps {
  visible: boolean;
  title: string;
  htmlContent: string;
  loading: boolean;
  onClose: () => void;
  onAgree?: () => void;
  readOnly?: boolean;
}

const tagsStyles = {
  h1: {
    fontSize: 20,
    fontWeight: "800" as const,
    color: "#111827",
    marginTop: 16,
    marginBottom: 10,
    lineHeight: 26,
  },
  h2: {
    fontSize: 17,
    fontWeight: "700" as const,
    color: "#1f2937",
    marginTop: 14,
    marginBottom: 8,
    lineHeight: 24,
  },
  h3: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: "#374151",
    marginTop: 12,
    marginBottom: 6,
  },
  p: {
    fontSize: 14,
    lineHeight: 22,
    color: "#4b5563",
    marginBottom: 10,
  },
  ul: {
    marginTop: 4,
    marginBottom: 12,
    paddingLeft: 16,
  },
  li: {
    fontSize: 14,
    lineHeight: 22,
    color: "#4b5563",
    marginBottom: 6,
  },
  strong: {
    fontWeight: "700" as const,
    color: "#111827",
  },
};

export default function PolicyViewerModal({
  visible,
  title,
  htmlContent,
  loading,
  onClose,
  onAgree,
  readOnly = false,
}: PolicyViewerModalProps) {
  const { width } = useWindowDimensions();
  const contentWidth = width - 48; // padding

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{title}</Text>
          <TouchableOpacity
            style={styles.closeIconBtn}
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close" size={24} color="#111827" />
          </TouchableOpacity>
        </View>

        {/* Body Content */}
        <View style={styles.body}>
          {loading ? (
            <View style={styles.loaderWrap}>
              <ActivityIndicator size="large" color="#FFD700" />
              <Text style={styles.loadingText}>Loading document...</Text>
            </View>
          ) : htmlContent ? (
            <ScrollView
              style={styles.scrollContent}
              contentContainerStyle={styles.scrollContainer}
              showsVerticalScrollIndicator={true}
            >
              <RenderHtml
                contentWidth={contentWidth}
                source={{ html: htmlContent }}
                tagsStyles={tagsStyles}
              />
            </ScrollView>
          ) : (
            <View style={styles.loaderWrap}>
              <Text style={styles.emptyText}>No content available.</Text>
            </View>
          )}
        </View>

        {/* Footer Buttons */}
        <View style={styles.footer}>
          {!readOnly && onAgree ? (
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
                <Text style={styles.secondaryBtnText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={onAgree}>
                <Text style={styles.primaryBtnText}>I Understand & Agree</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.fullCloseBtn} onPress={onClose}>
              <Text style={styles.fullCloseBtnText}>Close</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    flex: 1,
  },
  closeIconBtn: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: "#f3f4f6",
  },
  body: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  scrollContent: {
    flex: 1,
  },
  scrollContainer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 30,
  },
  loaderWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 15,
    color: "#9ca3af",
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
  },
  secondaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#374151",
  },
  primaryBtn: {
    flex: 1.5,
    height: 48,
    borderRadius: 12,
    backgroundColor: "#FFD700",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#000000",
  },
  fullCloseBtn: {
    width: "100%",
    height: 48,
    borderRadius: 12,
    backgroundColor: "#FFD700",
    alignItems: "center",
    justifyContent: "center",
  },
  fullCloseBtnText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#000000",
  },
});
