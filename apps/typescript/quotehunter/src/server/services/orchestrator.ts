import { CreateHuntRequest, QuoteHuntJob, TargetVendor } from '../types.js';
import { quoteStore } from '../store.js';
import { calleService } from './calle.js';

export class QuoteOrchestrator {
  private activeSimulatedTimers: Map<string, NodeJS.Timeout[]> = new Map();

  /**
   * Start a new quote hunt workflow across target vendors
   */
  async startQuoteHunt(request: CreateHuntRequest): Promise<QuoteHuntJob> {
    const jobId = 'QH-' + Math.floor(1000 + Math.random() * 9000);
    const now = new Date().toISOString();

    const targetVendors: TargetVendor[] = request.vendors.map((v, index) => ({
      id: `v_${index + 1}_${Math.random().toString(36).substring(2, 7)}`,
      name: v.name.trim() || `Provider #${index + 1}`,
      phone: v.phone.trim(),
      status: 'pending',
      updatedAt: now,
    }));

    const job: QuoteHuntJob = {
      id: jobId,
      title: `${request.category.toUpperCase()} Quote Hunt (${targetVendors.length} Providers)`,
      category: request.category,
      description: request.description,

      vendors: targetVendors,
      status: 'initializing',
      createdAt: now,
      updatedAt: now,
      summary: {
        totalVendors: targetVendors.length,
        quotedCount: 0,
        failedCount: 0,
        aiRecommendation: 'Initializing parallel AI phone agents...',
      },
    };

    quoteStore.createJob(job);

    const useLiveCalle = !request.dryRunSimulate;

    if (useLiveCalle) {
      if (!calleService.isLive()) {
        throw new Error('CALL-E API key is not configured in .env. Live calls cannot be initiated.');
      }
      this.executeLiveCalleJob(job);
    } else {
      this.executeSimulatedJob(job);
    }

    return job;
  }

  /**
   * Execute real live CALL-E parallel vendor calls (Production Mode)
   */
  private async executeLiveCalleJob(job: QuoteHuntJob) {
    try {
      quoteStore.updateJobStatus(job.id, 'active');

      await calleService.launchParallelVendorCalls({
        jobId: job.id,
        category: job.category,
        description: job.description,
        vendors: job.vendors,
        onVendorUpdate: (vendorId, updates) => {
          quoteStore.updateVendor(job.id, vendorId, updates);
        },
      });

      quoteStore.updateJobStatus(job.id, 'completed');
    } catch (err: any) {
      console.error('Error in live CALL-E call hunt:', err);
      quoteStore.updateJobStatus(job.id, 'failed');
    }
  }

  /**
   * Realistic simulated execution for dry-runs, interactive testing, and demo showcase
   */
  private async executeSimulatedJob(job: QuoteHuntJob) {
    quoteStore.updateJobStatus(job.id, 'active');
    const timers: NodeJS.Timeout[] = [];
    this.activeSimulatedTimers.set(job.id, timers);

    // Simulate staggered parallel phone calls
    job.vendors.forEach((vendor, index) => {
      const staggerDelay = index * 1200;
      const t1 = setTimeout(() => {
        // Dialing state
        quoteStore.updateVendor(job.id, vendor.id, { status: 'dialing' });

        // In-call state after 2.5s
        const inCallDelay = 2500 + Math.random() * 1500;
        const t2 = setTimeout(() => {
          quoteStore.updateVendor(job.id, vendor.id, {
            status: 'in-call',
            transcriptSummary: 'Connected. AI agent is discussing requirements and rates...',
          });

          // Call completion with realistic quotes based on category & language
          const completeDelay = 4000 + index * 2500 + Math.random() * 2000;
          const t3 = setTimeout(() => {
            this.applySimulatedVendorResult(job, vendor, index);
          }, completeDelay);
          timers.push(t3);
        }, inCallDelay);
        timers.push(t2);
      }, staggerDelay);
      timers.push(t1);
    });

    // Mark job completed after all simulated calls finish
    const totalDuration = 6000 + job.vendors.length * 3500;
    const tFinal = setTimeout(() => {
      quoteStore.updateJobStatus(job.id, 'completed');
      this.activeSimulatedTimers.delete(job.id);
    }, totalDuration);
    timers.push(tFinal);
  }

  private applySimulatedVendorResult(job: QuoteHuntJob, vendor: TargetVendor, index: number) {
    const presets: Record<string, any[]> = {
      painting: [
        {
          price: '$280',
          num: 280,
          avail: 'Next Monday',
          cond: 'Labor only, paint provided by client',
          evidence: '"We can do the full 3BHK for $280, takes 3 days."',
          notes: 'Experienced team of 3 painters with primer included.',
        },
        {
          price: '$350',
          num: 350,
          avail: 'Tomorrow morning',
          cond: 'Premium paint included',
          evidence: '"$350 flat with all materials, can start tomorrow."',
          notes: 'Includes masking tape and floor covering protection.',
        },
        {
          price: '$420',
          num: 420,
          avail: 'Within 2 days',
          cond: '2-year warranty + putty touchups',
          evidence: '"$420 total with a full 2-year warranty included."',
          notes: 'Specialized waterproof exterior & interior finish.',
        },
      ],
      plumbing: [
        {
          price: '$75',
          num: 75,
          avail: 'Today at 4 PM',
          cond: 'Spare parts billed extra',
          evidence: '"$75 standard repair fee, I can come at 4 PM today."',
          notes: 'Licensed plumber with 8+ years experience.',
        },
        {
          price: '$55',
          num: 55,
          avail: 'Within 1 hour',
          cond: 'No hidden fees',
          evidence: '"$55 all inclusive, sending technician in 30 mins."',
          notes: 'Express local emergency dispatch.',
        },
      ],
    };

    const categoryPresets = presets[job.category] || presets.painting;
    const preset = categoryPresets[index % categoryPresets.length];

    // Give 1 out of 4 vendors a "No Answer / Busy" state for realism
    if (index === 3) {
      quoteStore.updateVendor(job.id, vendor.id, {
        status: 'no-answer',
        providerNotes: 'Call rang 5 times, then went to voicemail.',
        transcriptSummary: 'Unreachable. Recommended to retry or call secondary number.',
      });
      return;
    }

    quoteStore.updateVendor(job.id, vendor.id, {
      status: 'quoted',
      priceEstimate: preset.price,
      priceNumeric: preset.num,
      availability: preset.avail,
      additionalConditions: preset.cond,
      evidenceSnippet: preset.evidence,
      providerNotes: preset.notes,
      transcriptSummary: `Verified quote received: ${preset.price} for ${preset.avail}.`,
    });
  }

  /**
   * Cancel an active quote hunt and abort all running carrier calls / timers
   */
  async cancelQuoteHunt(jobId: string) {
    const job = quoteStore.getJob(jobId);
    if (!job) return;

    // 1. Clear any active simulated timers
    const timers = this.activeSimulatedTimers.get(jobId);
    if (timers) {
      timers.forEach(t => clearTimeout(t));
      this.activeSimulatedTimers.delete(jobId);
    }

    // 2. Abort live CALL-E phone calls & carrier connections
    await calleService.cancelJobCalls(jobId);

    // 3. Mark job as failed / canceled
    quoteStore.updateJobStatus(jobId, 'failed');

    // 4. Mark any pending or in-flight vendors as canceled
    job.vendors.forEach(v => {
      if (['pending', 'initializing', 'dialing', 'ringing', 'in-call', 'analyzing'].includes(v.status)) {
        quoteStore.updateVendor(jobId, v.id, {
          status: 'failed',
          transcriptSummary: 'Call was canceled by user.',
          providerNotes: 'Call stopped by user request.',
        });
      }
    });
  }
}

export const quoteOrchestrator = new QuoteOrchestrator();
