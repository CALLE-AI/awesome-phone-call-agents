// ==========================================
// IDEMPOTENCY & DISPATCH LOCK MANAGER
// ==========================================

interface InFlightEntry {
    orderId: string;
    startedAt: number;
    status: 'in_progress' | 'completed' | 'unresolved' | 'failed';
    error?: string | undefined;
    result?: any;
}

class IdempotencyManager {
    private inFlight = new Map<string, InFlightEntry>();
    private completedKeys = new Map<string, { timestamp: number; result: any }>();
    private readonly lockTtlMs = 300_000; // 5 minutes lock TTL

    private normalizeOrderId(orderId: string): string {
        return (orderId || '').trim().toLowerCase();
    }

    /**
     * Attempts to acquire an execution lock for a dispatch request.
     * Lock key is strictly bound to the order ID to prevent caller headers from bypassing suppression.
     */
    public acquireLock(orderId: string): { success: boolean; reason?: string } {
        this.cleanExpired();

        const key = this.normalizeOrderId(orderId);
        if (!key) {
            return { success: false, reason: 'A valid non-empty order ID is required.' };
        }

        // Check if currently in-flight or locked in unresolved state
        const active = this.inFlight.get(key);
        if (active) {
            if (active.status === 'in_progress') {
                const ageSec = Math.round((Date.now() - active.startedAt) / 1000);
                return {
                    success: false,
                    reason: `Dispatch for order '${orderId}' is currently in progress (${ageSec}s). Duplicate call prevented.`
                };
            }
            if (active.status === 'unresolved') {
                return {
                    success: false,
                    reason: `Dispatch for order '${orderId}' is preserved in an unresolved state after a previous attempt. Re-dialing is prevented to avoid double-dialing.`
                };
            }
        }

        // Check if previously completed
        const completed = this.completedKeys.get(key);
        if (completed) {
            return {
                success: false,
                reason: `Dispatch for order '${orderId}' was already completed. Duplicate call prevented.`
            };
        }

        // Acquire lock
        this.inFlight.set(key, {
            orderId,
            startedAt: Date.now(),
            status: 'in_progress'
        });

        return { success: true };
    }

    /**
     * Preserves an ambiguous timeout or network failure in an unresolved locked state.
     * Does NOT release the lock, so retries cannot blindly re-dial.
     */
    public markUnresolved(orderId: string, error?: string) {
        const key = this.normalizeOrderId(orderId);
        if (!key) return;

        const entry = this.inFlight.get(key);
        if (entry) {
            entry.status = 'unresolved';
            entry.error = error || 'Operation timed out or ended ambiguously. Call state unresolved.';
        } else {
            this.inFlight.set(key, {
                orderId,
                startedAt: Date.now(),
                status: 'unresolved',
                error: error || 'Operation timed out or ended ambiguously.'
            });
        }
    }

    /**
     * Releases the lock only upon verified terminal completion.
     */
    public releaseLock(
        orderId: string,
        status: 'completed' | 'failed',
        error?: string,
        result?: any
    ) {
        const key = this.normalizeOrderId(orderId);
        if (!key) return;

        const entry = this.inFlight.get(key);

        if (entry) {
            entry.status = status;
            entry.error = error;
            entry.result = result;
        }

        if (status === 'completed') {
            this.completedKeys.set(key, {
                timestamp: Date.now(),
                result
            });
            this.inFlight.delete(key);
        } else if (status === 'failed') {
            this.inFlight.delete(key);
        }
    }

    public getLockStatus(orderId: string): InFlightEntry | undefined {
        const key = this.normalizeOrderId(orderId);
        return this.inFlight.get(key);
    }

    public isCompleted(orderId: string): boolean {
        const key = this.normalizeOrderId(orderId);
        return this.completedKeys.has(key);
    }

    public reset() {
        this.inFlight.clear();
        this.completedKeys.clear();
    }

    private cleanExpired() {
        const now = Date.now();
        for (const [key, entry] of this.inFlight.entries()) {
            if (entry.status === 'in_progress' && now - entry.startedAt > this.lockTtlMs) {
                // In-progress locks that exceed TTL transition to unresolved (fail-closed)
                entry.status = 'unresolved';
                entry.error = 'In-flight execution exceeded TTL timeout.';
            }
        }
    }
}

export const idempotencyManager = new IdempotencyManager();
