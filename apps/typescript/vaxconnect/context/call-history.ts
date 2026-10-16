export type CallHistoryRecord = {
    id: string;
    type: "availability" | "appointment";
    vaccine: string;
    hospital: string;
    status: string;
    createdAt: string;
    summary: string;
};

const STORAGE_KEY = "vaxconnect_call_history";

export function getCallHistory(): CallHistoryRecord[] {
    if (typeof window === "undefined") {
        return [];
    }

    try {
        const saved = localStorage.getItem(STORAGE_KEY);

        if (!saved) {
            return [];
        }

        return JSON.parse(saved);
    } catch (error) {
        console.error("Failed to load call history:", error);
        return [];
    }
}

export function addCallHistory(
    record: Omit<CallHistoryRecord, "id" | "createdAt">
) {
    if (typeof window === "undefined") {
        return;
    }

    try {
        const existing = getCallHistory();

        const newRecord: CallHistoryRecord = {
            ...record,
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
        };

        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify([newRecord, ...existing])
        );
    } catch (error) {
        console.error("Failed to save call history:", error);
    }
}