

import { useEffect } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { authApi } from "../lib/api";
import { supabase } from "../lib/supabase";

export default function GlobalChecklistListener() {
    console.log("🚀 GlobalChecklistListener Mounted");
    useEffect(() => {
        let channel: any;

        const startListener = async () => {
            let email: string | null = null;
            try {
                const me = await authApi.me();
                email = me?.email || null;
            } catch {
                try {
                    const {
                        data: { user },
                    } = await supabase.auth.getUser();
                    email = user?.email || null;
                } catch {}
            }

            if (!email) {
                console.log("No logged in user found");
                return;
            }

            console.log("=================================");
            console.log("CHECKLIST LISTENER STARTED");
            console.log("STAFF EMAIL:", email);

            channel = supabase
                .channel(`staff-checklist-${email}`)
                .on(
                    "postgres_changes",
                    {
                        event: "UPDATE",
                        schema: "public",
                        table: "bookings",

                        // Only this staff's bookings
                        filter: `assigned_staff_email=eq.${email}`,
                    },
                    (payload: any) => {
                        console.log("=================================");
                        console.log("REALTIME EVENT RECEIVED");
                        console.log("BOOKING ID:", payload.new?.id);
                        console.log(
                            "ASSIGNED STAFF:",
                            payload.new?.assigned_staff_email
                        );
                        console.log(
                            "CHECKLIST SUBMITTED:",
                            payload.new?.checklist_submitted
                        );

                        const oldChecklist = payload.old?.checklist_submitted;
                        const newChecklist = payload.new?.checklist_submitted;

                        if (!oldChecklist && newChecklist) {
                            console.log(
                                "CHECKLIST SUBMITTED FOR BOOKING:",
                                payload.new.id
                            );

                            Alert.alert(
                                "Checklist Submitted ✅",
                                "Customer completed the checklist. Complete the service now.",
                                [
                                    {
                                        text: "Later",
                                        style: "cancel",
                                    },
                                    {
                                        text: "Open Service",
                                        onPress: () => {
                                            router.push({
                                                pathname: "/assigned-service-details",
                                                params: {
                                                    booking: JSON.stringify(payload.new),
                                                },
                                            });
                                        },
                                    },
                                ]
                            );
                        }
                    }
                )
                .subscribe((status) => {
                    console.log("=================================");
                    console.log("CHECKLIST CHANNEL STATUS:", status);
                });
        };

        startListener();

        return () => {
            if (channel) {
                console.log("Removing checklist channel");
                supabase.removeChannel(channel);
            }
        };
    }, []);

    return null;
}