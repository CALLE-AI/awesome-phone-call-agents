<script lang="ts">
	import { invalidate } from '$app/navigation'
	import { page } from '$app/state'
	import { formatClock, formatDayLabel } from '$lib/today/model'
	import { Badge, Button, SectionHeader } from '$lib/ui'
	import {
		glossFor,
		groupByRun,
		isLiveState,
		maskPhones,
		pickDefaultRunId,
		sortSteps,
		stoppedRuns,
		type TimelineEvent,
		type TimelineRun
	} from './model'

	let { data } = $props()

	const FALLBACK_ZONE = 'Asia/Kolkata'
	let openSteps = $state<Set<number>>(new Set())
	let refreshing = $state(false)

	const rows = $derived(data.rows)
	const zone = $derived(rows?.timezone || FALLBACK_ZONE)
	const runs = $derived(rows?.runs ?? [])
	const byRun = $derived.by(() => groupByRun(rows?.events ?? [], runs.map((run) => run.id)))
	const defaultId = $derived(pickDefaultRunId(runs, byRun))
	const requestedId = $derived(page.url.searchParams.get('run'))
	const selected = $derived(
		runs.find((run) => run.id === requestedId) ?? runs.find((run) => run.id === defaultId) ?? null
	)
	const steps = $derived(sortSteps(selected ? (byRun.get(selected.id) ?? []) : []))
	const stopped = $derived(stoppedRuns(runs, byRun))
	const live = $derived(selected ? isLiveState(selected.state) : false)

	function runTitle(run: TimelineRun): string {
		return `${formatDayLabel(run.scheduled_for, zone)}, ${formatClock(run.scheduled_for, zone)}`
	}

	/* Step colour, from the event itself. A failure reason reads red. */
	function stepTone(event: TimelineEvent): 'brand' | 'success' | 'danger' {
		const detail = (event.detail ?? {}) as Record<string, unknown>
		if (typeof detail['failure_reason'] === 'string' && detail['failure_reason']) return 'danger'
		if (event.kind === 'ingested' || event.kind === 'finalised') return 'success'
		return 'brand'
	}

	function toggle(id: number) {
		const next = new Set(openSteps)
		if (next.has(id)) next.delete(id)
		else next.add(id)
		openSteps = next
	}

	function detailText(event: TimelineEvent): string {
		return maskPhones(JSON.stringify(event.detail ?? {}, null, 2))
	}

	async function refresh() {
		refreshing = true
		try {
			await invalidate('orma:timeline')
		} finally {
			refreshing = false
		}
	}
</script>

<svelte:head><title>Timeline · Orma</title></svelte:head>

<main class="timeline">
	{#if data.error || !rows}
		<section class="head">
			<h1>Timeline</h1>
			<p class="hint" role="alert">{data.error || 'Could not load your timeline.'}</p>
		</section>
	{:else if runs.length === 0}
		<section class="head">
			<h1>Timeline</h1>
			<p class="gloss">What happened to each call, step by step. Only your own runs.</p>
			<p class="hint">No runs yet. Your timeline appears after the first call is scheduled.</p>
		</section>
	{:else if !selected}
		<section class="head">
			<h1>Timeline</h1>
			<p class="hint" role="alert">That run is not on your timeline.</p>
		</section>
	{:else}
		<section class="head">
			<h1>Timeline</h1>
			<p class="gloss">What happened to each call, step by step. Only your own runs.</p>
		</section>

		<section class="picker">
			<SectionHeader title="Runs, newest first" />
			<ul>
				{#each runs as run (run.id)}
					<li>
						<a href="?run={run.id}" aria-current={run.id === selected.id ? 'true' : undefined}>
							{runTitle(run)} · {run.state}{#if (byRun.get(run.id)?.length ?? 0) === 0} · no steps yet{/if}
						</a>
					</li>
				{/each}
			</ul>
		</section>

		<section class="run">
			<div class="run-head">
				<h2 class="run-title">{runTitle(selected)}</h2>
				<div class="row tags">
					<Badge tone={live ? 'brand' : 'neutral'}>{selected.state}</Badge>
					{#if live}<Badge tone="brand">live</Badge>{/if}
					{#if selected.dry_run}<Badge>rehearsal</Badge>{/if}
				</div>
			</div>
			{#if live}
				<p class="hint">New steps appear as they happen.</p>
				<div>
					<Button variant="secondary" onclick={refresh} disabled={refreshing}>
						{refreshing ? 'Refreshing…' : 'Refresh'}
					</Button>
				</div>
			{/if}
			{#if steps.length === 0}
				<p class="hint">No steps recorded for this run yet.</p>
			{:else}
				<div class="steps">
					{#each steps as event, index (event.id)}
						<div class="step">
							<div class="rail">
								<span class="dot {stepTone(event)}" aria-hidden="true"></span>
								{#if index < steps.length - 1}<span class="line" aria-hidden="true"></span>{/if}
							</div>
							<div class="body">
								<span class="clock mono muted">{formatClock(event.at, zone, true)}</span>
								<span class="kind">{event.kind}</span>
								<span class="gloss">{glossFor(event.kind, event.detail, (iso) => formatClock(iso, zone))}</span>
								{#if openSteps.has(event.id)}
									<pre class="payload">{detailText(event)}</pre>
								{/if}
							</div>
							<Button
								variant="ghost"
								class="toggle"
								onclick={() => toggle(event.id)}
								ariaExpanded={openSteps.has(event.id)}
								ariaLabel={openSteps.has(event.id) ? `Hide detail for ${event.kind}` : `Show detail for ${event.kind}`}
							>
								{openSteps.has(event.id) ? 'Hide' : 'Show'}
							</Button>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		{#if stopped.length > 0}
			<section class="stopped">
				<SectionHeader title="A run that stopped" />
				{#each stopped as entry (entry.run.id)}
					<div class="stop-row">
						<span class="mono muted">{formatDayLabel(entry.run.scheduled_for, zone)}</span>
						<div class="stop-body">
							<a class="mono" href="?run={entry.run.id}">{entry.run.state}</a>
							<span class="gloss">Stopped{entry.lastKind ? ` at ${entry.lastKind}` : ''}.</span>
						</div>
					</div>
				{/each}
			</section>
		{/if}
	{/if}
</main>

<style>
	.timeline {
		width: 100%;
		max-width: 40rem;
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
	.gloss {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
	}
	.muted {
		color: var(--text-muted);
	}
	.mono {
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.picker ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.picker li {
		border-top: 1px solid var(--border);
	}
	.picker a {
		display: flex;
		align-items: center;
		min-height: var(--tap-target);
		padding: 0 var(--space-1);
		color: var(--text);
		font-size: var(--font-size-sm);
		text-decoration: none;
	}
	.picker a[aria-current='true'] {
		color: var(--brand);
		font-weight: var(--weight-semibold);
	}

	.run {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.run-head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.run-title {
		margin: 0;
		color: var(--text);
		font-size: var(--font-size-lg);
		line-height: var(--line-snug);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
	}
	.tags {
		gap: var(--space-1);
		flex-wrap: wrap;
	}

	.steps {
		display: flex;
		flex-direction: column;
	}
	.step {
		display: grid;
		grid-template-columns: 1rem minmax(0, 1fr) auto;
		gap: var(--space-3);
		align-items: flex-start;
	}
	.rail {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		align-self: stretch;
		min-height: 100%;
	}
	.dot {
		width: 10px;
		height: 10px;
		margin-top: 0.35rem;
		border-radius: 50%;
		flex: none;
	}
	.dot.brand {
		background: var(--brand);
	}
	.dot.success {
		background: var(--success);
	}
	.dot.danger {
		background: var(--danger);
	}
	.line {
		flex: 1;
		width: 2px;
		margin-top: 0.2rem;
		background: var(--border);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		padding-bottom: var(--space-4);
	}
	.clock {
		font-size: var(--font-size-xs);
	}
	.kind {
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
		font-weight: var(--weight-medium);
	}
	.body .gloss {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}
	.payload {
		margin: var(--space-2) 0 0;
		padding: var(--space-3);
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--font-size-xs);
		line-height: var(--line-normal);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.toggle {
		min-width: var(--tap-target);
	}

	.stopped {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.stop-row {
		display: grid;
		grid-template-columns: 5.2rem minmax(0, 1fr);
		gap: var(--space-3);
		padding: var(--space-3) 0;
		border-top: 1px solid var(--border);
	}
	.stop-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.stop-body a {
		color: var(--brand);
		text-decoration: none;
	}
	.stop-body a:hover {
		text-decoration: underline;
	}
	.stop-body .gloss {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}
</style>
