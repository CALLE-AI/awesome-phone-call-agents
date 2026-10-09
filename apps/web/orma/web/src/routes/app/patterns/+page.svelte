<script lang="ts">
	import { formatClock, formatDayLabel } from '$lib/today/model'
	import { SectionHeader, Stat } from '$lib/ui'
	import {
		axisLabel,
		completedSoFar,
		factEntries,
		isAnswered,
		moodLane,
		periodLabel,
		proseParagraphs,
		requiredDays,
		trendRuns
	} from './model'
	import type { PatternRows } from './+page'

	let { data } = $props()

	const FALLBACK_ZONE = 'Asia/Kolkata'
	const LANE_Y = [27, 57, 87, 117]
	const HOLLOW_Y = 140
	const PLOT_LEFT = 76
	const PLOT_RIGHT = 334

	const rows = $derived(data.rows as PatternRows | null)
	const zone = $derived(rows?.timezone || FALLBACK_ZONE)
	const facts = $derived((rows?.report?.facts ?? {}) as Record<string, unknown>)
	const sufficient = $derived(facts['sufficient_history'] === true)
	const notYet = $derived(!rows?.report || !sufficient)
	const paragraphs = $derived(rows?.report ? proseParagraphs(rows.report.prose) : [])
	const entries = $derived(factEntries(facts))
	const period = $derived(
		rows?.report
			? trendRuns(rows.runs, rows.report.period_start, rows.report.period_end)
			: []
	)
	const sent = $derived.by(() => {
		if (!rows?.report) return null
		const ids = new Set(period.map((run) => run.id))
		return (
			rows.deliveries.find(
				(delivery) => delivery.sent_at && (delivery.call_run_id === null || ids.has(delivery.call_run_id))
			) ?? null
		)
	})

	function pointX(index: number, total: number): number {
		return PLOT_LEFT + ((index + 0.5) * (PLOT_RIGHT - PLOT_LEFT)) / total
	}

	function sentLine(channel: string, sentAt: string): string {
		const when = `${formatDayLabel(sentAt, zone)} at ${formatClock(sentAt, zone)}`
		if (channel === 'telegram') return `Sent to Telegram on ${when}.`
		if (channel === 'email') return `Sent by email on ${when}.`
		return `Sent over ${channel} on ${when}.`
	}

	function pluralCalls(count: number): string {
		return count === 1 ? '1 call' : `${count} calls`
	}
</script>

<svelte:head><title>Patterns · Orma</title></svelte:head>

<main class="patterns">
	{#if data.error || !rows}
		<section class="head">
			<h1>Patterns</h1>
			<p class="hint" role="alert">{data.error || 'Could not load your patterns.'}</p>
		</section>
	{:else if notYet}
		<section class="head">
			<span class="label">Your first week</span>
			<h1>Patterns</h1>
		</section>
		<section class="card brand">
			<div class="notyet-title">Not enough calls yet</div>
			<p>
				A pattern needs a run of days. You have had {pluralCalls(completedSoFar(rows.runs))} so far.
				The first report comes after {requiredDays(rows.report?.facts as Record<string, unknown> | null)} observed days.
			</p>
			<p class="hint">Orma will not guess at a trend from a few mornings.</p>
		</section>
	{:else if rows.report}
		<section class="head">
			<span class="label">{periodLabel(facts, rows.report)}</span>
			<h1>Patterns</h1>
		</section>

		<div class="report">
			<section class="card prose">
				{#each paragraphs as paragraph}
					<p class="lede">{paragraph}</p>
				{/each}
				{#if sent?.sent_at}
					<p class="hint">{sentLine(sent.channel, sent.sent_at)}</p>
				{/if}
			</section>

			<div class="tiles">
				<SectionHeader title="Facts" hint="Computed by SQL" />
				<div class="tile-grid">
					{#each entries as entry (entry.key)}
						<div class="tile">
							<Stat value={String(entry.value)} label={entry.key} />
						</div>
					{/each}
				</div>
				<p class="hint">Every number in the report is one of these. If it is not, the report is written again.</p>
			</div>
		</div>

		<section class="chart">
			<SectionHeader title="Mood across the period" />
			{#if period.length === 0}
				<p class="hint">No calls fall inside this report period.</p>
			{:else}
				<svg class="trend" width="342" height="166" viewBox="0 0 342 166" style="display: block; overflow: visible; max-width: 100%;" role="img" aria-label="Mood trend across the report period">
					<text x="0" y="31" font-size="12" fill="var(--text-muted)">energised</text>
					<line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={LANE_Y[0]} y2={LANE_Y[0]} stroke="var(--border)" stroke-width="1" />
					<text x="0" y="61" font-size="12" fill="var(--text-muted)">ok</text>
					<line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={LANE_Y[1]} y2={LANE_Y[1]} stroke="var(--border)" stroke-width="1" />
					<text x="0" y="91" font-size="12" fill="var(--text-muted)">low</text>
					<line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={LANE_Y[2]} y2={LANE_Y[2]} stroke="var(--border)" stroke-width="1" />
					<text x="0" y="121" font-size="12" fill="var(--text-muted)">stressed</text>
					<line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={LANE_Y[3]} y2={LANE_Y[3]} stroke="var(--border)" stroke-width="1" />
					{#each period as run, index (run.id)}
						{@const lane = moodLane(run.mood)}
						{@const heard = lane >= 0 && isAnswered(run.disposition)}
						<circle
							cx={pointX(index, period.length)}
							cy={heard ? LANE_Y[lane] : HOLLOW_Y}
							r={heard ? 5 : 3.5}
							fill={heard ? 'var(--brand)' : 'none'}
							stroke={heard ? 'none' : 'var(--border-strong)'}
							stroke-width={heard ? 0 : 1.5}
						>
							<title>{axisLabel(run.local_date)}: {run.mood ?? 'no mood heard'}</title>
						</circle>
					{/each}
					<text x={pointX(0, period.length)} y="164" font-size="11" text-anchor="middle" fill="var(--text-muted)">{axisLabel(period[0].local_date)}</text>
					{#if period.length > 2}
						<text x={pointX(Math.floor(period.length / 2), period.length)} y="164" font-size="11" text-anchor="middle" fill="var(--text-muted)">{axisLabel(period[Math.floor(period.length / 2)].local_date)}</text>
					{/if}
					{#if period.length > 1}
						<text x={pointX(period.length - 1, period.length)} y="164" font-size="11" text-anchor="middle" fill="var(--text-muted)">{axisLabel(period[period.length - 1].local_date)}</text>
					{/if}
				</svg>
				<div class="row legend">
					<span class="mood"><i></i>what the call heard</span>
					<span class="mood"><i class="none"></i>no call answered</span>
				</div>
			{/if}
		</section>
	{:else}
		<section class="head">
			<h1>Patterns</h1>
			<p class="hint" role="alert">Could not load your patterns.</p>
		</section>
	{/if}
</main>

<style>
	.patterns {
		width: 100%;
		max-width: 56rem;
		margin: 0 auto;
		padding: var(--space-8) var(--space-5) var(--space-12);
		display: flex;
		flex-direction: column;
		gap: var(--space-8);
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	h1 {
		margin: 0;
		color: var(--text);
		font-size: var(--font-size-2xl);
		font-weight: var(--weight-bold);
		line-height: var(--line-tight);
		letter-spacing: var(--tracking-tight);
	}
	.label {
		color: var(--text-muted);
		font-size: var(--font-size-xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-6);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.card.brand {
		background: var(--brand-soft);
		border-color: color-mix(in srgb, var(--brand) 70%, transparent);
	}
	.card p {
		margin: 0;
		color: var(--text);
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
	}
	.notyet-title {
		color: var(--text);
		font-size: var(--font-size-xl);
		font-weight: var(--weight-semibold);
		line-height: var(--line-snug);
	}

	.report {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	@media (min-width: 900px) {
		.report {
			flex-direction: row;
			align-items: flex-start;
			gap: var(--space-8);
		}
		.report .prose {
			flex: 3;
		}
		.tiles {
			flex: 2;
		}
	}

	.prose {
		gap: var(--space-4);
	}
	.lede {
		margin: 0;
		color: var(--text);
		font-size: var(--font-size-lg);
		line-height: 1.65;
	}
	.prose .hint {
		margin: 0;
	}

	.tiles {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.tile-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: var(--space-3);
	}
	@media (min-width: 600px) {
		.tile-grid {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	.tile {
		padding: var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		min-width: 0;
	}
	.tile :global(.o-stat-value) {
		font-size: var(--font-size-lg);
		overflow-wrap: anywhere;
	}
	.tile :global(.o-stat-label) {
		overflow-wrap: anywhere;
	}

	.chart {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.legend {
		gap: var(--space-4);
		flex-wrap: wrap;
	}
	.mood {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		font-size: var(--font-size-sm);
		color: var(--text-muted);
	}
	.mood i {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--brand);
		display: inline-block;
	}
	.mood i.none {
		background: transparent;
		border: 1.5px solid var(--border-strong);
	}
</style>
