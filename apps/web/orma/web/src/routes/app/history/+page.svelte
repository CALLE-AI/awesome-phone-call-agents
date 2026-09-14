<script lang="ts">
	import { onMount } from 'svelte'
	import { page } from '$app/state'
	import { Badge, LiveDot, MoodMarker, SectionHeader } from '$lib/ui'
	import {
		LIVE_STATES,
		dispositionLabel,
		durationLabel,
		durationSeconds,
		formatClock,
		formatDayLabel,
		lastCallSummary,
		moodView,
		type LastCallSummary
	} from '$lib/today/model'
	import { historyHref, parseTParam, parseTurns, type TurnView } from './model'

	let { data } = $props()

	const FALLBACK_ZONE = 'Asia/Kolkata'

	let now = $state(new Date())

	const rows = $derived(data.rows)
	const zone = $derived(rows?.profile?.timezone || FALLBACK_ZONE)
	const transcriptsByRun = $derived(new Map((rows?.transcripts ?? []).map((row) => [row.call_run_id, row])))
	const resultsByRun = $derived(new Map((rows?.results ?? []).map((row) => [row.call_run_id, row])))
	const requestedRun = $derived(page.url.searchParams.get('run'))
	const requestedT = $derived(parseTParam(page.url.searchParams.get('t')))
	const expandedId = $derived.by(() => {
		const runs = rows?.runs ?? []
		if (requestedRun && runs.some((run) => run.id === requestedRun)) return requestedRun
		return runs[0]?.id ?? null
	})

	type RunView = {
		id: string
		day: string
		meta: string
		moodLabel: string
		moodNone: boolean
		live: boolean
		noConnection: boolean
		hasResult: boolean
		summary: LastCallSummary
		short: string
		turns: TurnView[]
	}

	const views = $derived.by((): RunView[] => {
		if (!rows) return []
		return rows.runs.map((run) => {
			const transcript = transcriptsByRun.get(run.id)
			const result = resultsByRun.get(run.id)
			const summary = lastCallSummary(run, rows.mentions, rows.commitments, result?.structured ?? null, zone, now)
			const duration = durationLabel(durationSeconds(transcript?.raw))
			const mood = moodView(run)
			const live = (LIVE_STATES as readonly string[]).includes(run.state)
			const noConnection = run.disposition === 'not_answered' || run.state === 'failed'
			const at = formatClock(run.dispatched_at ?? run.scheduled_for, zone)
			const disposition = dispositionLabel(run.disposition)
			const meta = live
				? 'On the call'
				: [at, duration, disposition].filter(Boolean).join(' · ')
			const parts: string[] = []
			if (summary.retired > 0) parts.push(summary.retired === 1 ? 'Retired 1' : `Retired ${summary.retired}`)
			if (summary.committed > 0) parts.push(summary.committed === 1 ? 'Committed 1' : `Committed ${summary.committed}`)
			if (summary.captured > 0) parts.push(summary.captured === 1 ? 'Captured 1' : `Captured ${summary.captured}`)
			const short = live
				? 'On the call.'
				: noConnection
					? 'The call did not connect.'
					: parts.length > 0
						? parts.join(' · ')
						: 'Nothing new'
			return {
				id: run.id,
				day: formatDayLabel(run.dispatched_at ?? run.scheduled_for, zone),
				meta,
				moodLabel: mood.label,
				moodNone: mood.none,
				live,
				noConnection,
				hasResult: result?.valid ?? false,
				summary,
				short,
				turns: parseTurns(transcript?.turns)
			}
		})
	})

	const hero = $derived(views[0] ?? null)
	const earlier = $derived(views.slice(1))

	function isMarked(view: RunView, turn: TurnView): boolean {
		return view.id === expandedId && requestedT !== null && turn.offsetSeconds === requestedT
	}

	$effect(() => {
		if (requestedT === null || !expandedId) return
		document.querySelector('[data-turn-mark="true"]')?.scrollIntoView({ block: 'center' })
	})

	onMount(() => {
		const clock = setInterval(() => (now = new Date()), 30_000)
		return () => clearInterval(clock)
	})
</script>

<svelte:head><title>History · Orma</title></svelte:head>
{#snippet detail(view: RunView)}
	<section class="call" aria-label={`Call on ${view.day}`}>
		<div class="titles">
			<div class="row top">
				<span class="title">{view.day}</span>
				<MoodMarker label={view.moodLabel} none={view.moodNone} />
			</div>
			<span class="muted meta">{view.meta}</span>
		</div>
		{#if view.live}
			<div class="row live-head"><LiveDot /><span class="label brand">On the call</span></div>
			<p class="hint">Nothing to do here. The transcript lands once the call ends.</p>
		{:else}
			<div class="row tags">
				<Badge>retired {view.summary.retired}</Badge><Badge>committed {view.summary.committed}</Badge><Badge>captured {view.summary.captured}</Badge><Badge>mentions {view.summary.mentionCount}</Badge>
			</div>
			{#if view.noConnection}
				<p class="muted">The call did not connect.</p>
			{/if}
			{#if view.summary.lines.length > 0}
				<div class="lines">
					{#each view.summary.lines as line, index (index)}
						<div class="row line">
							<span class="label line-label">{line.label}</span>
							<span class="line-text">{line.text}</span>
							{#if line.offset}
								<a class="mono" href={historyHref(view.id, line.offsetSeconds)}>{line.offset}</a>
							{/if}
						</div>
					{/each}
				</div>
			{:else if !view.noConnection && view.hasResult}
				<p class="muted">Nothing was retired, promised or captured on this call.</p>
			{/if}
			{#if !view.hasResult}
				<p class="muted">Orma did not write anything down from this call.</p>
			{/if}
			{#if view.turns.length > 0}
				<div class="transcript">
					{#each view.turns as turn, index (index)}
						{@const marked = isMarked(view, turn)}
						<div class="turn" class:mark={marked} data-turn-mark={marked ? 'true' : null}>
							{#if turn.offset}
								<a class="mono" href={historyHref(view.id, turn.offsetSeconds)}>{turn.offset}</a>
							{:else}
								<span class="mono muted">—</span>
							{/if}
							<span class="who">{turn.who}</span><span>{turn.text}</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</section>
{/snippet}

<main class="history">
	{#if data.error || !rows}
		<section class="head">
			<h1>History</h1>
			<p class="hint" role="alert">{data.error || 'Could not load your history.'}</p>
		</section>
	{:else if views.length === 0}
		<section class="head">
			<h1>History</h1>
			<p class="gloss">Every call, newest first. Mood is what the call heard.</p>
		</section>
		<section><p class="muted">No calls yet. Your finished calls will land here, newest first.</p></section>
	{:else}
		<section class="head">
			<h1>History</h1>
			<p class="gloss">Every call, newest first. Mood is what the call heard.</p>
		</section>

		{#if hero}
			{@const open = hero.id === expandedId}
			{#if open}
				{@render detail(hero)}
			{:else}
				<section class="call">
					<a class="rowlink" href={historyHref(hero.id)}>
						<span class="copy">
							<span class="row-day">{hero.day}</span>
							<span class="row meta">{hero.meta} <MoodMarker label={hero.moodLabel} none={hero.moodNone} /></span>
							<span class="line-text">{hero.short}</span>
						</span>
						<span class="muted" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5l4.5 4.5L6 12.5"></path></svg></span>
					</a>
				</section>
			{/if}
		{/if}

		{#if earlier.length > 0}
			<section class="list">
				<SectionHeader title="Earlier" />
				{#each earlier as view (view.id)}
					{#if view.id === expandedId}
						{@render detail(view)}
					{:else}
						<a class="rowlink" href={historyHref(view.id)}>
							<span class="copy">
								<span class="row-day">{view.day}</span>
								<span class="row meta">{view.meta} <MoodMarker label={view.moodLabel} none={view.moodNone} /></span>
								<span class="line-text">{view.short}</span>
							</span>
							<span class="muted" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5l4.5 4.5L6 12.5"></path></svg></span>
						</a>
					{/if}
				{/each}
			</section>
		{/if}
	{/if}
</main>

<style>
	.history {
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
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
	}
	.mono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: var(--tap-target);
		min-height: var(--tap-target);
		font-family: var(--font-mono);
		font-size: var(--font-size-sm);
	}
	a.mono {
		color: var(--brand);
	}
	.label {
		color: var(--text-muted);
		font-size: var(--font-size-xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
	}
	.label.brand {
		color: var(--brand);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.call {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.titles {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.top {
		justify-content: space-between;
		gap: var(--space-3);
	}
	.title {
		color: var(--text);
		font-size: var(--font-size-lg);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
	}
	.meta {
		font-size: var(--font-size-sm);
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.tags {
		gap: var(--space-1);
		flex-wrap: wrap;
	}
	.live-head {
		gap: var(--space-2);
	}

	.lines {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.line {
		gap: var(--space-3);
		align-items: baseline;
	}
	.line-label {
		flex: none;
		width: 5.5rem;
	}
	.line-text {
		flex: 1;
		color: var(--text);
		font-size: var(--font-size-sm);
	}

	.transcript {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		border-left: 2px solid var(--border);
		padding-left: var(--space-2);
	}
	.turn {
		display: grid;
		grid-template-columns: 3rem 3.6rem minmax(0, 1fr);
		gap: var(--space-1) var(--space-2);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		align-items: baseline;
	}
	.turn .who {
		font-size: var(--font-size-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		color: var(--text-muted);
	}
	.turn > span:last-child {
		color: var(--text);
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
	}
	.turn.mark {
		background: var(--brand-soft);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.rowlink {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) 0;
		border-top: 1px solid var(--border);
		color: inherit;
		text-decoration: none;
	}
	.copy {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.row-day {
		color: var(--text);
		font-size: var(--font-size-base);
		font-weight: var(--weight-medium);
	}
</style>
