export type ServiceCategory = 
  | 'painting'
  | 'plumbing'
  | 'electrical'
  | 'carpentry'
  | 'catering'
  | 'cleaning'
  | 'logistics'
  | 'general';



export interface ConversationTurn {
  role: 'agent' | 'user';
  text: string;
  timeRange: string;
  latency?: string;
  duration?: string;
  interrupted?: boolean;
}

export interface TargetVendor {
  id: string;
  name: string;
  phone: string;
  status: 'pending' | 'initializing' | 'dialing' | 'ringing' | 'in-call' | 'analyzing' | 'quoted' | 'no-answer' | 'refused' | 'failed' | 'voicemail' | 'error';
  callId?: string;
  callHash?: string;
  audioUrl?: string;
  durationSeconds?: number;
  durationFormatted?: string;
  turns?: ConversationTurn[];
  priceEstimate?: string;
  priceNumeric?: number;
  availability?: string;
  additionalConditions?: string;
  providerNotes?: string;
  evidenceSnippet?: string;
  transcriptSummary?: string;
  confidence?: 'high' | 'medium' | 'low';
  confidenceScore?: number;
  createdAt?: string;
  completedAt?: string;
  updatedAt?: string;
}

export interface QuoteHuntJob {
  id: string;
  title: string;
  category: ServiceCategory;
  description: string;

  vendors: TargetVendor[];
  status: 'initializing' | 'active' | 'completed' | 'partial' | 'failed';
  calleTaskId?: string;
  createdAt: string;
  updatedAt: string;
  summary?: {
    totalVendors: number;
    quotedCount: number;
    failedCount: number;
    lowestQuoteVendorId?: string;
    fastestVendorId?: string;
    aiRecommendation?: string;
  };
}

export interface CreateHuntRequest {
  category: ServiceCategory;
  description: string;

  vendors: {
    name: string;
    phone: string;
  }[];
  dryRunSimulate?: boolean;
}
