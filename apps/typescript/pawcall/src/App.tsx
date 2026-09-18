import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AppState,
  EmergencyReport,
  Responder,
  TabType,
} from './types';
import { INITIAL_RESPONDERS, WIDER_SEARCH_RESPONDERS } from './data/mockResponders';
import { INITIAL_HISTORY } from './data/mockHistory';
import { Navbar } from './components/Navbar';
import { HomeScreen } from './components/HomeScreen';
import { EmergencyForm } from './components/EmergencyForm';
import { RadarScanner } from './components/RadarScanner';
import { TestCallModal } from './components/TestCallModal';
import { CallInterface } from './components/CallInterface';
import { SuccessState } from './components/SuccessState';
import { FailureState } from './components/FailureState';
import { HistoryList } from './components/HistoryList';
import { HowItWorksScreen } from './components/HowItWorksScreen';
import { RequestSummaryModal } from './components/RequestSummaryModal';

export default function App() {

  // Navigation tab state
  const [activeTab, setActiveTab] = useState<TabType>('sos');

  // Emergency flow state machine
  const [appState, setAppState] = useState<AppState>('IDLE');

  // Current active emergency report
  const [currentReport, setCurrentReport] = useState<Partial<EmergencyReport>>({
    locationName: 'Market St & 5th Ave (GPS Detected)',
    animalType: 'Dog',
    description: '',
    urgency: 'urgent',
    callerPhone: '',
    status: 'pending',
  });

  // Responders queue for active scan/call
  const [activeResponders, setActiveResponders] = useState<Responder[]>(INITIAL_RESPONDERS);
  const [currentResponderIndex, setCurrentResponderIndex] = useState(0);
  const [isWiderSearch, setIsWiderSearch] = useState(false);

  // History records state
  const [history, setHistory] = useState<EmergencyReport[]>(INITIAL_HISTORY);

  // Detail Modal view
  const [showSummaryModal, setShowSummaryModal] = useState(false);

  // Reset / Start SOS Flow
  const handleStartSOS = () => {
    setActiveTab('sos');
    setAppState('EMERGENCY_FORM');
  };

  // Submit Emergency Details
  const handleEmergencyFormSubmit = (data: {
    description: string;
    animalType: string;
    callerPhone: string;
    locationName: string;
  }) => {
    const newReport: Partial<EmergencyReport> = {
      id: `SOS-${Math.floor(1000 + Math.random() * 9000)}`,
      timestamp: new Date(),
      locationName: data.locationName,
      animalType: data.animalType,
      description: data.description,
      callerPhone: data.callerPhone,
      urgency: 'urgent',
      status: 'scanning',
    };
    setCurrentReport(newReport);
    setIsWiderSearch(false);
    setActiveResponders(INITIAL_RESPONDERS);
    setCurrentResponderIndex(0);
    setAppState('SCANNING');
  };

  // Radar Scan Complete -> Proceed to Test Call Setup
  const handleScanComplete = (discovered: Responder[]) => {
    setActiveResponders(discovered);
    setCurrentResponderIndex(0);
    setAppState('TEST_CALL_SETUP');
  };

  // Start Test Call from Modal
  const handleStartTestCall = (testPhone: string) => {
    setCurrentReport((prev) => ({
      ...prev,
      callerPhone: testPhone || prev.callerPhone,
      status: 'calling',
    }));
    setAppState('CALLING');
  };

  // Responder Accepted Simulation
  const handleResponderAccepted = (responder: Responder) => {
    const finalizedReport: EmergencyReport = {
      id: currentReport.id || `SOS-${Date.now()}`,
      timestamp: currentReport.timestamp || new Date(),
      locationName: currentReport.locationName || 'GPS Location detected',
      coordinates: { lat: 37.7749, lng: -122.4194 },
      animalType: currentReport.animalType || 'Animal',
      description: currentReport.description || 'Emergency assistance requested.',
      urgency: 'urgent',
      callerPhone: currentReport.callerPhone,
      status: 'confirmed',
      assignedResponder: responder,
      etaMinutes: Math.max(10, Math.round(responder.distanceKm * 5 + 4)),
    };

    setCurrentReport(finalizedReport);
    setHistory((prev) => [finalizedReport, ...prev]);
    setAppState('SUCCESS');
  };

  // Responder Rejected -> Escalation logic
  const handleResponderRejected = (_responder: Responder) => {
    const nextIdx = currentResponderIndex + 1;
    if (nextIdx < activeResponders.length) {
      setCurrentResponderIndex(nextIdx);
      // Stays in CALLING state, CallInterface will switch to the next responder
    } else {
      // All responders in the queue exhausted
      const failedReport: EmergencyReport = {
        id: currentReport.id || `SOS-${Date.now()}`,
        timestamp: currentReport.timestamp || new Date(),
        locationName: currentReport.locationName || 'GPS Location detected',
        coordinates: { lat: 37.7749, lng: -122.4194 },
        animalType: currentReport.animalType || 'Animal',
        description: currentReport.description || 'Emergency assistance requested.',
        urgency: 'urgent',
        callerPhone: currentReport.callerPhone,
        status: 'unresolved',
      };
      setHistory((prev) => [failedReport, ...prev]);
      setAppState('NO_RESPONDER_AVAILABLE');
    }
  };

  // Try Wider Search fallback
  const handleTryWiderSearch = () => {
    setIsWiderSearch(true);
    setActiveResponders([...INITIAL_RESPONDERS, ...WIDER_SEARCH_RESPONDERS]);
    setCurrentResponderIndex(0);
    setAppState('SCANNING');
  };

  // Back to Home
  const handleBackToHome = () => {
    setAppState('IDLE');
    setIsWiderSearch(false);
    setActiveTab('sos');
  };

  const isEmergencyInFlight =
    appState === 'SCANNING' || appState === 'TEST_CALL_SETUP' || appState === 'CALLING';

  return (
    <div className="min-h-screen bg-[#F5EFEB] flex flex-col font-sans antialiased text-[#28221E] selection:bg-[#B84227] selection:text-white">
      {/* Top Clean Sticky Navigation */}
      <Navbar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          if (tab !== 'sos' && appState === 'EMERGENCY_FORM') {
            setAppState('IDLE');
          }
        }}
        isEmergencyActive={isEmergencyInFlight}
      />

      {/* Main View Area */}
      <div className="flex-1 w-full max-w-4xl mx-auto flex items-center justify-center relative px-3 sm:px-6">
        {/* Central Core Application Screen */}
        <main className="w-full max-w-xl min-h-[calc(100vh-5rem)] flex flex-col items-center justify-center py-4 relative z-10">
          <AnimatePresence mode="wait">
            {/* TAB 1: SOS WORKFLOW */}
            {activeTab === 'sos' && (
              <motion.div
                key={appState}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.25 }}
                className="w-full flex-1 flex flex-col items-center justify-center"
              >
                {/* SCREEN 1: IDLE / HOME */}
                {appState === 'IDLE' && (
                  <HomeScreen onStartSOS={handleStartSOS} />
                )}

                {/* SCREEN 3: SCANNING / RADAR */}
                {appState === 'SCANNING' && (
                  <RadarScanner
                    allResponders={activeResponders}
                    onScanComplete={handleScanComplete}
                    locationName={currentReport.locationName || 'GPS Location Locked'}
                    isWiderSearch={isWiderSearch}
                  />
                )}

                {/* SCREEN 4: TEST CALL SETUP MODAL */}
                {appState === 'TEST_CALL_SETUP' && (
                  <div className="w-full flex-1 flex items-center justify-center relative">
                    {/* Keep radar in background for seamless visual context */}
                    <div className="opacity-30 blur-xs pointer-events-none absolute inset-0 flex items-center justify-center">
                      <RadarScanner
                        allResponders={activeResponders}
                        onScanComplete={() => {}}
                        locationName={currentReport.locationName || 'GPS Location Locked'}
                      />
                    </div>
                    <TestCallModal
                      initialPhone={currentReport.callerPhone}
                      nextResponder={activeResponders[currentResponderIndex] || activeResponders[0]}
                      onStartTestCall={handleStartTestCall}
                      onCancel={handleBackToHome}
                    />
                  </div>
                )}

                {/* SCREEN 5 & 7: LIVE SIMULATED CALL & ESCALATION */}
                {appState === 'CALLING' && (
                  <CallInterface
                    report={currentReport}
                    activeResponder={activeResponders[currentResponderIndex] || activeResponders[0]}
                    responderIndex={currentResponderIndex}
                    totalResponders={activeResponders.length}
                    onResponderAccepted={handleResponderAccepted}
                    onResponderRejected={handleResponderRejected}
                  />
                )}

                {/* SCREEN 6: RESPONDER ACCEPTS / SUCCESS */}
                {appState === 'SUCCESS' && (
                  <SuccessState
                    report={currentReport}
                    assignedResponder={
                      currentReport.assignedResponder ||
                      activeResponders[currentResponderIndex] ||
                      activeResponders[0]
                    }
                    onViewRequest={() => setShowSummaryModal(true)}
                    onBackToHome={handleBackToHome}
                  />
                )}

                {/* SCREEN 8: NO RESPONDER AVAILABLE / FALLBACK */}
                {appState === 'NO_RESPONDER_AVAILABLE' && (
                  <FailureState
                    report={currentReport}
                    onTryWiderSearch={handleTryWiderSearch}
                    onBackToHome={handleBackToHome}
                  />
                )}
              </motion.div>
            )}

            {/* TAB 2: RESCUE HISTORY */}
            {activeTab === 'history' && (
              <motion.div
                key="history-tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="w-full flex-1 flex flex-col"
              >
                <HistoryList
                  history={history}
                  onNewSOS={() => {
                    setActiveTab('sos');
                    handleStartSOS();
                  }}
                />
              </motion.div>
            )}

            {/* TAB 3: HOW IT WORKS / ABOUT */}
            {activeTab === 'about' && (
              <motion.div
                key="about-tab"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="w-full flex-1 flex flex-col"
              >
                <HowItWorksScreen onBackToSOS={() => setActiveTab('sos')} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* SCREEN 2: EMERGENCY DETAILS BOTTOM SHEET / MODAL */}
      <EmergencyForm
        isOpen={appState === 'EMERGENCY_FORM'}
        onClose={() => setAppState('IDLE')}
        onSubmit={handleEmergencyFormSubmit}
      />

      {/* REQUEST SUMMARY MODAL (From Success Screen) */}
      <RequestSummaryModal
        isOpen={showSummaryModal}
        onClose={() => setShowSummaryModal(false)}
        report={currentReport}
        responder={
          currentReport.assignedResponder ||
          activeResponders[currentResponderIndex] ||
          activeResponders[0]
        }
      />
    </div>
  );
}
