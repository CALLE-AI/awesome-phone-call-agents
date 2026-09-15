'use client';

import { useState, useEffect, useRef } from 'react';
import { useChat } from '@ai-sdk/react';
import { ChatBubble } from './ui/ChatBubble';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { DocumentaryCheckPanel } from './ui/DocumentaryCheckPanel';
import { CallVerdictCard } from './ui/CallVerdictCard';
import { GSTINResult } from '@/lib/gstin';
import { CalleResult } from '@/lib/calle';
import { CACResult } from '@/lib/cac';
import { CompaniesHouseResult } from '@/lib/companieshouse';
import { ChinaVerificationResult } from '@/lib/china';
import { USVerificationResult } from '@/lib/us';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Workspace() {
  const { messages, sendMessage, status, error } = useChat();
  const [input, setInput] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptSummary, setTranscriptSummary] = useState<string | null>(null);
  const [isSummarising, setIsSummarising] = useState(false);
  const summarisedRef = useRef(false); // prevent double-fetch
  const chatEndRef = useRef<HTMLDivElement>(null);
  const isLoading = status === 'submitted' || status === 'streaming';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput('');
  };

  // Extract latest tool results from message parts
  let latestGstinResult: GSTINResult | null = null;
  let latestCallResult: CalleResult | null = null;
  let latestCacResult: CACResult | null = null;
  let latestNgCallResult: CalleResult | null = null;
  let latestChResult: CompaniesHouseResult | null = null;
  let latestUkCallResult: CalleResult | null = null;
  let latestChinaResult: ChinaVerificationResult | null = null;
  let latestChinaCallResult: CalleResult | null = null;
  let latestUsResult: USVerificationResult | null = null;
  let latestUsCallResult: CalleResult | null = null;
  let isCheckingGstin = false;
  let isCalling = false;
  let isCheckingCac = false;
  let isCallingNg = false;
  let isCheckingCh = false;
  let isCallingUk = false;
  let isCheckingChina = false;
  let isCallingChina = false;
  let isCheckingUs = false;
  let isCallingUs = false;
  let claimedTerms: string | undefined;
  let transcriptToSummarise: string | null | undefined;

  for (const message of messages) {
    for (const part of message.parts) {
      // India path
      if (part.type === 'tool-verifySupplier') {
        if (part.state === 'output-available') latestGstinResult = part.output as GSTINResult;
        else if (part.state === 'input-streaming' || part.state === 'input-available') isCheckingGstin = true;
      }
      if (part.type === 'tool-callSupplier') {
        if (part.state === 'input-available' || part.state === 'input-streaming') {
          isCalling = true;
          claimedTerms = (part as { input?: { claimedTerms?: string } }).input?.claimedTerms;
        }
        if (part.state === 'output-available') {
          isCalling = false;
          latestCallResult = part.output as CalleResult;
          claimedTerms = (part as { input?: { claimedTerms?: string } }).input?.claimedTerms;
        }
      }
      // Nigeria path
      if (part.type === 'tool-verifyNigeriaSupplier') {
        if (part.state === 'output-available') latestCacResult = part.output as CACResult;
        else if (part.state === 'input-streaming' || part.state === 'input-available') isCheckingCac = true;
      }
      if (part.type === 'tool-callNigeriaSupplier') {
        if (part.state === 'input-available' || part.state === 'input-streaming') {
          isCallingNg = true;
          claimedTerms = (part as { input?: { claimedTerms?: string } }).input?.claimedTerms;
        }
        if (part.state === 'output-available') {
          isCallingNg = false;
          latestNgCallResult = part.output as CalleResult;
          claimedTerms = (part as { input?: { claimedTerms?: string } }).input?.claimedTerms;
        }
      }
      // UK path
      if (part.type === 'tool-verifyUKSupplier') {
        if (part.state === 'output-available') latestChResult = part.output as CompaniesHouseResult;
        else if (part.state === 'input-streaming' || part.state === 'input-available') isCheckingCh = true;
      }
      if (part.type === 'tool-callUKSupplier') {
        if (part.state === 'input-available' || part.state === 'input-streaming') {
          isCallingUk = true;
          claimedTerms = (part as { input?: { claimedTerms?: string } }).input?.claimedTerms;
        }
        if (part.state === 'output-available') {
          isCallingUk = false;
          latestUkCallResult = part.output as CalleResult;
          claimedTerms = (part as { input?: { claimedTerms?: string } }).input?.claimedTerms;
        }
      }
      // China path
      if (part.type === 'tool-verifyChinaSupplier') {
        if (part.state === 'output-available') latestChinaResult = part.output as ChinaVerificationResult;
        else if (part.state === 'input-streaming' || part.state === 'input-available') isCheckingChina = true;
      }
      if (part.type === 'tool-callChinaSupplier') {
        if (part.state === 'input-available' || part.state === 'input-streaming') {
          isCallingChina = true;
          claimedTerms = (part as { input?: { claimedTerms?: string } }).input?.claimedTerms;
        }
        if (part.state === 'output-available') {
          isCallingChina = false;
          latestChinaCallResult = part.output as CalleResult;
          claimedTerms = (part as { input?: { claimedTerms?: string } }).input?.claimedTerms;
        }
      }
      // US path
      if (part.type === 'tool-verifyUSSupplier') {
        if (part.state === 'output-available') latestUsResult = part.output as USVerificationResult;
        else if (part.state === 'input-streaming' || part.state === 'input-available') isCheckingUs = true;
      }
      if (part.type === 'tool-callUSSupplier') {
        if (part.state === 'input-available' || part.state === 'input-streaming') {
          isCallingUs = true;
          claimedTerms = (part as { input?: { claimedTerms?: string } }).input?.claimedTerms;
        }
        if (part.state === 'output-available') {
          isCallingUs = false;
          latestUsCallResult = part.output as CalleResult;
          claimedTerms = (part as { input?: { claimedTerms?: string } }).input?.claimedTerms;
        }
      }
    }
  }

  // Auto-fetch Gemini summary once the call result + transcript arrive
  useEffect(() => {
    if (
      transcriptToSummarise &&
      !summarisedRef.current &&
      !isSummarising
    ) {
      summarisedRef.current = true;
      setIsSummarising(true);
      fetch('/api/summarize-transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: transcriptToSummarise,
          verdict: activeCallResult?.verdict,
          companyName: activeCallResult?.confirmed_business_name,
        }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.summary) setTranscriptSummary(data.summary);
        })
        .catch(console.error)
        .finally(() => setIsSummarising(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcriptToSummarise]);

  // Scroll to bottom when new content arrives
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, transcriptSummary, isSummarising]);

  const hasAnyResult =
    latestGstinResult || isCheckingGstin || latestCallResult || isCalling ||
    latestCacResult || isCheckingCac || latestNgCallResult || isCallingNg ||
    latestChResult || isCheckingCh || latestUkCallResult || isCallingUk ||
    latestChinaResult || isCheckingChina || latestChinaCallResult || isCallingChina ||
    latestUsResult || isCheckingUs || latestUsCallResult || isCallingUs;
  const activeCallResult = latestCallResult || latestNgCallResult || latestUkCallResult || latestChinaCallResult || latestUsCallResult;
  const activeCheckResult = latestGstinResult;

  // Transcript summarisation fires when ANY call result with transcript arrives
  transcriptToSummarise = activeCallResult?.transcript;

  return (
    <main className="flex flex-1 overflow-hidden">
      {/* Left Column: Copilot */}
      <section className="w-full md:w-[65%] h-full border-r border-gray-200 relative bg-app-bg flex flex-col">
        <div className="flex-1 overflow-y-auto p-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="w-12 h-12 rounded-xl bg-success flex items-center justify-center text-white font-bold text-lg mb-4">
                TC
              </div>
              <h1 className="text-xl font-bold text-primary-text mb-2">TradeCheck Copilot</h1>
              <p className="text-secondary-text text-sm max-w-xs">
                Tell me about your trade deal. I&apos;ll ask a few questions, then run a documentary check and a live call to verify the supplier.
              </p>
            </div>
          ) : (
            messages.map(m => {
              const text = m.parts.map(p => (p.type === 'text' ? p.text : '')).join('');
              if (!text) return null;
              return (
                <ChatBubble
                  key={m.id}
                  role={m.role === 'user' ? 'user' : 'ai'}
                  content={text}
                />
              );
            })
          )}

          {/* Transcript summary bubble — shown after call completes */}
          {isSummarising && (
            <div className="flex gap-1.5 items-center mt-4 px-2">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-bounce" />
              <span className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-green-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              <span className="text-xs text-secondary-text ml-1">Summarising call...</span>
            </div>
          )}
          {transcriptSummary && (
            <ChatBubble
              role="ai"
              content={
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-secondary-text">Call Summary</div>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="text-sm leading-relaxed mb-2">{children}</p>,
                      h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1">{children}</h1>,
                      h2: ({ children }) => <h2 className="text-sm font-bold mt-3 mb-1">{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
                      ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1 text-sm">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1 text-sm">{children}</ol>,
                      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      hr: () => <hr className="my-3 border-gray-200" />,
                    }}
                  >
                    {transcriptSummary}
                  </ReactMarkdown>
                  {activeCallResult?.transcript && (
                    <button
                      onClick={() => setShowTranscript(true)}
                      className="mt-3 text-xs text-black underline underline-offset-2 hover:text-gray-600 transition-colors"
                    >
                      View full transcript →
                    </button>
                  )}
                </div>
              }
            />
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-200">
              Error communicating with Copilot: {error.message}
            </div>
          )}

          {isLoading && (
            <div className="flex gap-1.5 items-center mt-4 px-2">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="p-4 bg-gray-200 border-t border-gray-300">
          <form
            onSubmit={handleSubmit}
            className={`flex gap-2 bg-white p-2 rounded-lg border items-center transition-all duration-200 ${
              isLoading
                ? 'border-green-400 shadow-[0_0_0_3px_rgba(74,222,128,0.15)] animate-pulse-subtle'
                : 'border-gray-300'
            }`}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isLoading ? 'Thinking...' : 'Describe the trade deal to verify...'}
              disabled={isLoading}
              className={`border-none shadow-none focus:ring-0 flex-1 bg-transparent transition-opacity duration-200 ${
                isLoading ? 'opacity-50 cursor-not-allowed' : 'opacity-100'
              }`}
            />
            <Button
              type="submit"
              disabled={isLoading}
              className="w-10 h-10 p-0 rounded-full flex items-center justify-center flex-shrink-0"
            >
              {isLoading ? (
                <svg
                  className="animate-spin"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle
                    className="opacity-25"
                    cx="12" cy="12" r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2.01 21L23 12L2.01 3L2 10l15 2l-15 2z" fill="currentColor"/>
                </svg>
              )}
            </Button>
          </form>
        </div>
      </section>

      {/* Right Column: Verification Workflow */}
      <section className="hidden md:flex md:w-[35%] bg-white h-full flex-col p-6 overflow-y-auto">
        <div className="mb-6">
          <h2 className="text-lg font-bold text-primary-text mb-1">Verification Workflow</h2>
          <p className="text-sm text-secondary-text">
            {latestCallResult
              ? 'Verification complete.'
              : hasAnyResult
              ? 'Running verification checks...'
              : 'The Copilot will build the verification steps here once it gathers the requirements.'}
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {!hasAnyResult ? (
            <div className="border border-dashed border-gray-300 rounded-lg p-8 flex flex-col items-center justify-center text-center bg-gray-50">
              <span className="text-secondary-text text-sm">Awaiting Copilot input...</span>
            </div>
          ) : (
            <>
              {/* India path: GSTIN documentary check */}
              {(latestGstinResult || isCheckingGstin) && (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${latestGstinResult ? 'bg-black text-white' : 'bg-gray-200 text-gray-500'}`}>1</div>
                    <span className="text-sm font-medium text-primary-text">GSTIN Documentary Check</span>
                  </div>
                  <DocumentaryCheckPanel data={latestGstinResult} loading={isCheckingGstin} />
                </>
              )}

              {/* Nigeria path: CAC documentary check */}
              {(latestCacResult || isCheckingCac) && (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${latestCacResult ? 'bg-black text-white' : 'bg-gray-200 text-gray-500'}`}>1</div>
                    <span className="text-sm font-medium text-primary-text">CAC Documentary Check</span>
                  </div>
                  {isCheckingCac && (
                    <div className="bg-white border border-gray-200 rounded-lg p-6 flex flex-col items-center justify-center h-36">
                      <div className="w-6 h-6 border-2 border-gray-400 border-t-black rounded-full animate-spin mb-3" />
                      <span className="text-secondary-text text-sm">Querying CAC Registry...</span>
                    </div>
                  )}
                  {latestCacResult && (
                    <div className="bg-white border border-gray-200 rounded-lg p-5 flex flex-col gap-3">
                      <div className="flex justify-between items-start">
                        <h3 className="text-base font-bold text-primary-text">CAC Lookup</h3>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          latestCacResult.isVerified
                            ? 'bg-green-100 text-green-800 border-green-200'
                            : 'bg-gray-100 text-gray-800 border-gray-200'
                        }`}>
                          {latestCacResult.isVerified ? 'Found' : 'Not Found'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">Company Name</span>
                          <span className="text-primary-text font-medium">{latestCacResult.companyName}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">RC Number</span>
                          <span className="text-primary-text font-medium">{latestCacResult.rcNumber}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">Status</span>
                          <span className="text-primary-text font-medium">{latestCacResult.status}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">Reg. Date</span>
                          <span className="text-primary-text font-medium">{latestCacResult.registrationDate}</span>
                        </div>
                      </div>
                      <div className="text-xs text-secondary-text border-t border-gray-100 pt-2">
                        Source: {latestCacResult.source}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* UK path: Companies House documentary check */}
              {(latestChResult || isCheckingCh) && (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${latestChResult ? 'bg-black text-white' : 'bg-gray-200 text-gray-500'}`}>1</div>
                    <span className="text-sm font-medium text-primary-text">Companies House Check</span>
                  </div>
                  {isCheckingCh && (
                    <div className="bg-white border border-gray-200 rounded-lg p-6 flex flex-col items-center justify-center h-36">
                      <div className="w-6 h-6 border-2 border-gray-400 border-t-black rounded-full animate-spin mb-3" />
                      <span className="text-secondary-text text-sm">Querying Companies House...</span>
                    </div>
                  )}
                  {latestChResult && (
                    <div className="bg-white border border-gray-200 rounded-lg p-5 flex flex-col gap-3">
                      <div className="flex justify-between items-start">
                        <h3 className="text-base font-bold text-primary-text">Companies House</h3>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          latestChResult.isVerified
                            ? latestChResult.isActive
                              ? 'bg-green-100 text-green-800 border-green-200'
                              : 'bg-yellow-100 text-yellow-800 border-yellow-200'
                            : 'bg-gray-100 text-gray-800 border-gray-200'
                        }`}>
                          {latestChResult.isVerified ? (latestChResult.isActive ? 'Active' : 'Inactive') : 'Not Found'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">Company Name</span>
                          <span className="text-primary-text font-medium">{latestChResult.companyName}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">Company No.</span>
                          <span className="text-primary-text font-medium">{latestChResult.companyNumber}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">Status</span>
                          <span className="text-primary-text font-medium capitalize">{latestChResult.status}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">Incorporated</span>
                          <span className="text-primary-text font-medium">{latestChResult.incorporatedOn}</span>
                        </div>
                        {latestChResult.companyType && (
                          <div className="col-span-2">
                            <span className="text-secondary-text text-xs block mb-0.5">Type</span>
                            <span className="text-primary-text font-medium capitalize">{latestChResult.companyType.replace(/-/g, ' ')}</span>
                          </div>
                        )}
                        {latestChResult.address && latestChResult.address !== 'N/A' && (
                          <div className="col-span-2">
                            <span className="text-secondary-text text-xs block mb-0.5">Registered Address</span>
                            <span className="text-primary-text font-medium">{latestChResult.address}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* China path: Documentary check */}
              {(latestChinaResult || isCheckingChina) && (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${latestChinaResult ? 'bg-black text-white' : 'bg-gray-200 text-gray-500'}`}>1</div>
                    <span className="text-sm font-medium text-primary-text">China Verification Check</span>
                  </div>
                  {isCheckingChina && (
                    <div className="bg-white border border-gray-200 rounded-lg p-6 flex flex-col items-center justify-center h-36">
                      <div className="w-6 h-6 border-2 border-gray-400 border-t-black rounded-full animate-spin mb-3" />
                      <span className="text-secondary-text text-sm">Querying Registry...</span>
                    </div>
                  )}
                  {latestChinaResult && (
                    <div className="bg-white border border-gray-200 rounded-lg p-5 flex flex-col gap-3">
                      <div className="flex justify-between items-start">
                        <h3 className="text-base font-bold text-primary-text">Company Verification</h3>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          latestChinaResult.isVerified
                            ? 'bg-green-100 text-green-800 border-green-200'
                            : 'bg-gray-100 text-gray-800 border-gray-200'
                        }`}>
                          {latestChinaResult.isVerified ? 'Found' : 'Not Found'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="col-span-2">
                          <span className="text-secondary-text text-xs block mb-0.5">Company Name</span>
                          <span className="text-primary-text font-medium">{latestChinaResult.companyName}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">USCC</span>
                          <span className="text-primary-text font-medium">{latestChinaResult.uscc}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">Legal Rep</span>
                          <span className="text-primary-text font-medium">{latestChinaResult.legalRepresentative}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">Status</span>
                          <span className="text-primary-text font-medium">{latestChinaResult.status}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">Reg. Capital</span>
                          <span className="text-primary-text font-medium">{latestChinaResult.registeredCapital}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* US path: Documentary check */}
              {(latestUsResult || isCheckingUs) && (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${latestUsResult ? 'bg-black text-white' : 'bg-gray-200 text-gray-500'}`}>1</div>
                    <span className="text-sm font-medium text-primary-text">US Verification Check</span>
                  </div>
                  {isCheckingUs && (
                    <div className="bg-white border border-gray-200 rounded-lg p-6 flex flex-col items-center justify-center h-36">
                      <div className="w-6 h-6 border-2 border-gray-400 border-t-black rounded-full animate-spin mb-3" />
                      <span className="text-secondary-text text-sm">Querying US Registry...</span>
                    </div>
                  )}
                  {latestUsResult && (
                    <div className="bg-white border border-gray-200 rounded-lg p-5 flex flex-col gap-3">
                      <div className="flex justify-between items-start">
                        <h3 className="text-base font-bold text-primary-text">Company Verification</h3>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          latestUsResult.isVerified
                            ? 'bg-green-100 text-green-800 border-green-200'
                            : 'bg-gray-100 text-gray-800 border-gray-200'
                        }`}>
                          {latestUsResult.isVerified ? 'Found' : 'Not Found'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div className="col-span-2">
                          <span className="text-secondary-text text-xs block mb-0.5">Company Name</span>
                          <span className="text-primary-text font-medium">{latestUsResult.companyName}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">EIN</span>
                          <span className="text-primary-text font-medium">{latestUsResult.ein}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">State of Inc.</span>
                          <span className="text-primary-text font-medium">{latestUsResult.stateOfIncorporation}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">Status</span>
                          <span className="text-primary-text font-medium">{latestUsResult.status}</span>
                        </div>
                        <div>
                          <span className="text-secondary-text text-xs block mb-0.5">Entity Type</span>
                          <span className="text-primary-text font-medium">{latestUsResult.entityType}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Step 2: Live Call */}
              {(activeCheckResult || latestCacResult || latestChResult || latestChinaResult || latestUsResult || isCalling || isCallingNg || isCallingUk || isCallingChina || isCallingUs || activeCallResult) && (
                <>
                  <div className="flex items-center gap-2 mt-2 mb-1">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${activeCallResult ? 'bg-black text-white' : 'bg-gray-200 text-gray-500'}`}>2</div>
                    <span className="text-sm font-medium text-primary-text">Live Call Verification</span>
                  </div>
                  <CallVerdictCard
                    data={activeCallResult}
                    loading={isCalling || isCallingNg || isCallingUk || isCallingChina || isCallingUs}
                    claimedTerms={claimedTerms}
                    onViewTranscript={() => setShowTranscript(true)}
                  />
                </>
              )}
            </>
          )}
        </div>
      </section>

      {/* Transcript Modal */}
      {showTranscript && activeCallResult?.transcript && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6"
          onClick={() => setShowTranscript(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-6 border-b border-gray-200">
              <h3 className="text-lg font-bold text-primary-text">Full Call Transcript</h3>
              <button
                onClick={() => setShowTranscript(false)}
                className="text-secondary-text hover:text-primary-text text-xl leading-none"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-6">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="text-sm text-primary-text mb-2 leading-relaxed">{children}</p>,
                  h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-sm font-bold mt-3 mb-1">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
                  ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1 text-sm">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1 text-sm">{children}</ol>,
                  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  hr: () => <hr className="my-3 border-gray-200" />,
                  code: ({ children }) => <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono">{children}</code>,
                  blockquote: ({ children }) => <blockquote className="border-l-2 border-gray-300 pl-3 my-2 italic text-sm text-gray-600">{children}</blockquote>,
                }}
              >
                {activeCallResult?.transcript ?? ''}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}