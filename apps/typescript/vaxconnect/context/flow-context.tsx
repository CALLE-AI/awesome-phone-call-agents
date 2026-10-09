"use client";

import {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode,
} from "react";

type ChildFlow = {
    dob: string;
    vaccines: string[];
    pinCode: string;
};

type TravelFlow = {
    country: string;
    vaccines: string[];
    pinCode: string;
};

type BookingProvider = {
    hospital: string;
    price: string;
    appointment_required: string;
    earliest_availability: string;
};

type FlowState = {
    child: ChildFlow;
    travel: TravelFlow;
    generalVaccine: string;
    generalPinCode: string;

    selectedVaccine: string;
    selectedProvider: BookingProvider | null;

    setChild: (c: Partial<ChildFlow>) => void;
    setTravel: (t: Partial<TravelFlow>) => void;
    setGeneralVaccine: (vaccine: string) => void;
    setGeneralPinCode: (pinCode: string) => void;

    setSelectedVaccine: (vaccine: string) => void;
    setSelectedProvider: (provider: BookingProvider | null) => void;
};

const FlowContext = createContext<FlowState | null>(null);

const defaultChild: ChildFlow = {
    dob: "",
    vaccines: [],
    pinCode: "",
};

const defaultTravel: TravelFlow = {
    country: "",
    vaccines: [],
    pinCode: "",
};

const defaultGeneralVaccine = "";
const defaultGeneralPinCode = "";

export function FlowProvider({ children }: { children: ReactNode }) {
    const [child, setChildState] =
        useState<ChildFlow>(defaultChild);

    const [travel, setTravelState] =
        useState<TravelFlow>(defaultTravel);

    const [generalVaccine, setGeneralVaccineState] =
        useState<string>(defaultGeneralVaccine);

    const [generalPinCode, setGeneralPinCodeState] =
        useState<string>(defaultGeneralPinCode);

    const [selectedVaccine, setSelectedVaccineState] =
        useState<string>("");

    const [selectedProvider, setSelectedProviderState] =
        useState<BookingProvider | null>(null);

    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        try {
            const savedChild =
                localStorage.getItem("vaxconnect_child");

            const savedTravel =
                localStorage.getItem("vaxconnect_travel");

            const savedGeneralVaccine =
                localStorage.getItem(
                    "vaxconnect_general_vaccine"
                );

            const savedGeneralPinCode =
                localStorage.getItem(
                    "vaxconnect_general_pin"
                );

            const savedSelectedVaccine =
                localStorage.getItem(
                    "vaxconnect_selected_vaccine"
                );

            const savedSelectedProvider =
                localStorage.getItem(
                    "vaxconnect_selected_provider"
                );

            if (savedChild) {
                const parsedChild = JSON.parse(savedChild);

                setChildState({
                    ...defaultChild,
                    ...parsedChild,
                });
            }

            if (savedTravel) {
                const parsedTravel = JSON.parse(savedTravel);

                setTravelState({
                    ...defaultTravel,
                    ...parsedTravel,
                });
            }

            if (savedGeneralVaccine) {
                setGeneralVaccineState(
                    savedGeneralVaccine
                );
            }

            if (savedGeneralPinCode) {
                setGeneralPinCodeState(
                    savedGeneralPinCode
                );
            }

            if (savedSelectedVaccine) {
                setSelectedVaccineState(
                    savedSelectedVaccine
                );
            }

            if (savedSelectedProvider) {
                setSelectedProviderState(
                    JSON.parse(savedSelectedProvider)
                );
            }
        } catch (error) {
            console.error(
                "Failed to load VaxConnect profile:",
                error
            );
        } finally {
            setLoaded(true);
        }
    }, []);

    useEffect(() => {
        if (!loaded) return;

        localStorage.setItem(
            "vaxconnect_child",
            JSON.stringify(child)
        );
    }, [child, loaded]);

    useEffect(() => {
        if (!loaded) return;

        localStorage.setItem(
            "vaxconnect_travel",
            JSON.stringify(travel)
        );
    }, [travel, loaded]);

    useEffect(() => {
        if (!loaded) return;

        localStorage.setItem(
            "vaxconnect_general_vaccine",
            generalVaccine
        );
    }, [generalVaccine, loaded]);

    useEffect(() => {
        if (!loaded) return;

        localStorage.setItem(
            "vaxconnect_general_pin",
            generalPinCode
        );
    }, [generalPinCode, loaded]);

    useEffect(() => {
        if (!loaded) return;

        localStorage.setItem(
            "vaxconnect_selected_vaccine",
            selectedVaccine
        );
    }, [selectedVaccine, loaded]);

    useEffect(() => {
        if (!loaded) return;

        if (selectedProvider) {
            localStorage.setItem(
                "vaxconnect_selected_provider",
                JSON.stringify(selectedProvider)
            );
        } else {
            localStorage.removeItem(
                "vaxconnect_selected_provider"
            );
        }
    }, [selectedProvider, loaded]);

    const setChild = (c: Partial<ChildFlow>) => {
        setChildState((prev) => ({
            ...prev,
            ...c,
        }));
    };

    const setTravel = (t: Partial<TravelFlow>) => {
        setTravelState((prev) => ({
            ...prev,
            ...t,
        }));
    };

    const setGeneralVaccine = (vaccine: string) => {
        setGeneralVaccineState(vaccine);
    };

    const setGeneralPinCode = (pinCode: string) => {
        setGeneralPinCodeState(pinCode);
    };

    const setSelectedVaccine = (vaccine: string) => {
        setSelectedVaccineState(vaccine);
    };

    const setSelectedProvider = (
        provider: BookingProvider | null
    ) => {
        setSelectedProviderState(provider);
    };

    return (
        <FlowContext.Provider
            value={{
                child,
                travel,
                generalVaccine,
                generalPinCode,

                selectedVaccine,
                selectedProvider,

                setChild,
                setTravel,
                setGeneralVaccine,
                setGeneralPinCode,

                setSelectedVaccine,
                setSelectedProvider,
            }}
        >
            {children}
        </FlowContext.Provider>
    );
}

export function useFlow() {
    const ctx = useContext(FlowContext);

    if (!ctx) {
        throw new Error(
            "useFlow must be used inside FlowProvider"
        );
    }

    return ctx;
}