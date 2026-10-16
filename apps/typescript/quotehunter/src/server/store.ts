import { EventEmitter } from 'events';
import { QuoteHuntJob, TargetVendor } from './types.js';

class QuoteStore extends EventEmitter {
  private jobs: Map<string, QuoteHuntJob> = new Map();

  createJob(job: QuoteHuntJob): QuoteHuntJob {
    this.jobs.set(job.id, job);
    this.emit(`job:${job.id}`, { type: 'created', job });
    this.emit('global', { type: 'created', jobId: job.id });
    return job;
  }

  getJob(id: string): QuoteHuntJob | undefined {
    return this.jobs.get(id);
  }

  getAllJobs(): QuoteHuntJob[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  updateVendor(
    jobId: string,
    vendorId: string,
    updates: Partial<TargetVendor>
  ): QuoteHuntJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;

    const vendorIndex = job.vendors.findIndex((v) => v.id === vendorId);
    if (vendorIndex === -1) return undefined;

    const currentVendor = job.vendors[vendorIndex];
    const updatedVendor: TargetVendor = {
      ...currentVendor,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    job.vendors[vendorIndex] = updatedVendor;
    job.updatedAt = new Date().toISOString();

    // Re-compute job summary
    this.recomputeSummary(job);

    this.emit(`job:${jobId}`, {
      type: 'vendor_updated',
      vendor: updatedVendor,
      job,
    });
    this.emit('global', { type: 'vendor_updated', jobId, vendorId });
    return job;
  }

  updateJobStatus(
    jobId: string,
    status: QuoteHuntJob['status'],
    calleTaskId?: string
  ): QuoteHuntJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;

    job.status = status;
    if (calleTaskId) job.calleTaskId = calleTaskId;
    job.updatedAt = new Date().toISOString();

    this.recomputeSummary(job);

    this.emit(`job:${jobId}`, { type: 'status_updated', status, job });
    this.emit('global', { type: 'status_updated', jobId, status });
    return job;
  }

  private recomputeSummary(job: QuoteHuntJob) {
    const total = job.vendors.length;
    const quoted = job.vendors.filter((v) => v.status === 'quoted');
    const failed = job.vendors.filter((v) =>
      ['no-answer', 'refused', 'error'].includes(v.status)
    );

    let lowestVendor: TargetVendor | undefined;
    let fastestVendor: TargetVendor | undefined;

    for (const v of quoted) {
      if (v.priceNumeric && v.priceNumeric > 0) {
        if (!lowestVendor || (lowestVendor.priceNumeric && v.priceNumeric < lowestVendor.priceNumeric)) {
          lowestVendor = v;
        }
      }
    }

    let recommendation = '';
    if (quoted.length > 0) {
      if (lowestVendor) {
        recommendation = `💡 Recommendation: ${lowestVendor.name} offers the lowest quote at ${lowestVendor.priceEstimate} (${lowestVendor.availability || 'standard timeframe'}).`;
      } else {
        recommendation = `Received ${quoted.length} quote(s) from providers. Review the comparison matrix below to select your best fit.`;
      }
    } else if (failed.length === total) {
      recommendation = `⚠️ None of the target vendors were reachable or able to provide an immediate quote. Try retrying or adding alternative local vendors.`;
    } else {
      recommendation = `🎙️ AI calling agents are currently active. Real-time quotes will populate here as calls complete.`;
    }

    job.summary = {
      totalVendors: total,
      quotedCount: quoted.length,
      failedCount: failed.length,
      lowestQuoteVendorId: lowestVendor?.id,
      fastestVendorId: fastestVendor?.id,
      aiRecommendation: recommendation,
    };
  }
}

export const quoteStore = new QuoteStore();
