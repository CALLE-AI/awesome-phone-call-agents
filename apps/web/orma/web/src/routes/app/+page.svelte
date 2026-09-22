<script lang="ts">
	import { invalidate } from '$app/navigation'
	import { navigating, page } from '$app/state'
	import { onMount } from 'svelte'
	import { Button, ItemLine, LiveDot, MoodMarker, SectionHeader } from '$lib/ui'
	import { TELEGRAM_BOT_USERNAME } from '$lib/telegram-link'
	import {
		addedLabel,
		callBlock,
		dispositionLabel,
		durationSeconds,
		formatClock,
		formatDayLabel,
		formatNextCall,
		isFirstRun,
		lastCallHeadline,
		lastCallSummary,
		liveSteps,
		mentionLabel,
		moodView,
		nextSlotInstant,
		openItemsView,
		pickLiveRun,
		pickNextRun,
		todaysCallView
	} from '$lib/today/model'

	let { data } = $props()

	const LIVE_POLL_MS = 15_000
	const FALLBACK_ZONE = 'Asia/Kolkata'

	let now = $state(new Date())

	const rows = $derived(data.rows)
	const zone = $derived(rows?.profile?.timezone || FALLBACK_ZONE)
	const name = $derived(rows?.profile?.display_name ?? '')
	const nextRun = $derived(rows ? pickNextRun(rows.runs, now) : null)
	const liveRun = $derived(rows ? pickLiveRun(rows.runs) : null)
	const firstRun = $derived(rows ? isFirstRun(rows.runs) : false)
	const firstCallAt = $derived(
		nextRun?.scheduled_for ?? (rows ? nextSlotInstant(rows.slots, zone, now)?.toISOString() : undefined)
	)
	const open = $derived(rows ? openItemsView(rows.items, rows.openMentions, zone, now) : [])
	const lastCall = $derived(rows?.lastCall ?? null)
	const summary = $derived(
		rows && lastCall
			? lastCallSummary(
					lastCall,
					rows.lastMentions,
					rows.lastCommitments,
					rows.lastResultStructured,
					zone,
					now
				)
			: null
	)
	const OPEN_SHOWN = 5
	// The dispatcher refuses these runs. Today says why instead of promising a time.
	const nextBlock = $derived(
		rows ? callBlock(rows.profile, rows.consents, nextRun, rows.slots) : null
	)
	const todays = $derived(rows ? todaysCallView(rows.liveBriefing, open) : null)

	// A skeleton only for a real navigation. Invalidation polls keep the page.
	const navigatingAway = $derived(
		navigating !== null &&
			navigating.to !== null &&
			navigating.to.url.pathname !== page.url.pathname
	)

	onMount(() => {
		const clock = setInterval(() => (now = new Date()), 30_000)
		return () => clearInterval(clock)
	})

	$effect(() => {
		if (!liveRun) return
		const poll = setInterval(() => void invalidate('orma:today'), LIVE_POLL_MS)
		return () => clearInterval(poll)
	})

	function historyHref(runId: string, offset?: number | null): string {
		const base = `/app/history?run=${encodeURIComponent(runId)}`
		return offset === null || offset === undefined ? base : `${base}&t=${offset}`
	}
</script>

<svelte:head>
	<title>Today · Orma</title>
</svelte:head>

<main class="today">
	{#if navigatingAway}
		<div class="skeleton" aria-hidden="true">
			<span class="bone bone-line w-12"></span>
			<span class="bone bone-title"></span>
			<span class="bone bone-card"></span>
			<span class="bone bone-card short"></span>
			<span class="bone bone-line w-8"></span>
			<span class="bone bone-line w-10"></span>
			<span class="bone bone-line w-9"></span>
		</div>
	{:else if data.error || !rows}
		<section class="head">
			<h1>Today</h1>
			<p class="hint" role="alert">{data.error || 'Could not load Today.'}</p>
		</section>
	{:else if liveRun}
		<section class="head">
			<span class="label">{formatDayLabel(now, zone)}</span>
			<h1>Today</h1>
		</section>

		<section class="card brand live" aria-live="polite">
			<div class="row live-head">
				<LiveDot />
				<span class="label brand">Calling now</span>
			</div>
			<div class="live-title">Your {formatClock(liveRun.scheduled_for, zone)} call</div>
			<ol class="steps">
				{#each liveSteps(liveRun, zone) as step, index (index)}
					<li class="row step" class:todo={step.status === 'todo'} class:now={step.status === 'now'}>
						<span class="step-mark">
							{#if step.status === 'done'}
								<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"></path></svg>
							{:else if step.status === 'now'}
								<LiveDot />
							{:else}
								<span class="ring" aria-hidden="true"></span>
							{/if}
						</span>
						<span class="step-label">{step.label}</span>
						<span class="mono muted">{step.at}</span>
					</li>
				{/each}
			</ol>
			<p class="hint">Nothing to do here. This page updates on its own.</p>
		</section>

		{#if todays?.fromBriefing}
			<section class="list">
				<SectionHeader title="On today's call" hint="Orma is leading with these, in this order." />
				{#each todays.items.slice(0, OPEN_SHOWN) as item (item.id)}
					<ItemLine text={item.text} meta={item.meta} />
				{:else}
					<p class="muted empty">Nothing was open when Orma prepared this call.</p>
				{/each}
			</section>
		{:else}
			<section class="list">
				<SectionHeader title="Open · {open.length}">
					<a class="small" href="/app/items">All items</a>
				</SectionHeader>
				<p class="hint">The call's order shows here once Orma has prepared the call.</p>
				{#each open.slice(0, OPEN_SHOWN) as item (item.id)}
					<ItemLine text={item.text} meta={item.meta} />
				{/each}
			</section>
		{/if}
	{:else if firstRun}
		<section class="head">
			<span class="label">{formatDayLabel(now, zone)}</span>
			<h1>Welcome{name ? `, ${name}` : ''}</h1>
		</section>

		<section class="card brand first">
			<span class="label brand">Your first call</span>
			{#if nextBlock}
				<div class="big">{nextBlock.title}</div>
				<p class="hint">{nextBlock.detail}</p>
				<div class="row actions">
					<Button variant="secondary" href="/app/settings">Open Settings</Button>
				</div>
			{:else if firstCallAt}
				<div class="big">{formatNextCall(firstCallAt, zone, now)}</div>
				<p>Two minutes. Orma leads with what you've told it, asks what's new, and hangs up.</p>
				<p class="hint">
					{zone}. It comes from a number you won't recognise, and your phone may call it spam. Answer
					it anyway.
				</p>
			{:else}
				<div class="big">Not set yet</div>
				<p class="hint">Choose a time in <a href="/app/settings">Settings</a> and Orma will call then.</p>
			{/if}
		</section>

		<section class="list">
			<SectionHeader title="What Orma knows so far · {open.length}" />
			{#each open as item (item.id)}
				{@const row = rows.items.find((candidate) => candidate.id === item.id)}
				<ItemLine text={item.text} meta={row ? addedLabel(row, zone, now) : ''} />
			{/each}
			<p class="hint after-list">
				Send anything {open.length > 0 ? 'else ' : ''}to
				<a href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}>@{TELEGRAM_BOT_USERNAME}</a>, or just say it on
				the call.
			</p>
		</section>

		<section class="list">
			<SectionHeader title="After the call" />
			<p class="muted">
				What was captured, retired and promised shows up here, with the transcript a tap away.
			</p>
		</section>
	{:else}
		<section class="head">
			<span class="label">{formatDayLabel(now, zone)}</span>
			<h1>Today</h1>
		</section>

		<section class="card brand">
			<span class="label brand">Next call</span>
			{#if nextBlock}
				<div class="big">{nextBlock.title}</div>
				<p class="hint">{nextBlock.detail}</p>
				<div class="row actions">
					<Button variant="secondary" href="/app/settings">Open Settings</Button>
				</div>
			{:else if nextRun}
				<div class="big">{formatNextCall(nextRun.scheduled_for, zone, now)}</div>
				<p class="hint">{zone}. It comes from a number you won't recognise. Answer it anyway.</p>
				<div class="row actions">
					<Button variant="secondary" href="/app/settings">Cancel this call</Button>
					<Button variant="ghost" href="/app/settings">Change time</Button>
				</div>
			{:else}
				<div class="big">None scheduled</div>
				<p class="hint">No call is booked right now. Set a time or resume calls in Settings.</p>
				<div class="row actions">
					<Button variant="secondary" href="/app/settings">Open Settings</Button>
				</div>
			{/if}
		</section>

		{#if lastCall && summary}
			{@const mood = moodView(lastCall)}
			<section class="last">
				<SectionHeader title="Last call">
					<MoodMarker label={mood.label} none={mood.none} />
				</SectionHeader>
				<p class="headline">
					{lastCallHeadline(lastCall, zone, now, durationSeconds(rows.lastTranscriptRaw))}
				</p>
				<p class="hint">
					{[dispositionLabel(lastCall.disposition), mentionLabel(summary.mentionCount)]
						.filter(Boolean)
						.join(' · ')}
				</p>
				{#if summary.lines.length > 0}
					<div class="lines">
						{#each summary.lines as line, index (index)}
							<div class="row line">
								<span class="label line-label">{line.label}</span>
								<span class="line-text">{line.text}</span>
								{#if line.offset}
									<a class="mono" href={historyHref(lastCall.id, line.offsetSeconds)}>{line.offset}</a>
								{/if}
							</div>
						{/each}
					</div>
				{:else if lastCall.disposition === 'not_answered'}
					<p class="muted">Nobody picked up. Every item stays open for the next call.</p>
				{:else}
					<p class="muted">Nothing was retired, promised or captured on this call.</p>
				{/if}
				<a class="small" href={historyHref(lastCall.id)}>Read the transcript</a>
			</section>
		{/if}

		<section class="list">
			<SectionHeader title="Open · {open.length}">
				<a class="small" href="/app/items">All items</a>
			</SectionHeader>
			{#each open.slice(0, OPEN_SHOWN) as item (item.id)}
				<ItemLine text={item.text} meta={item.meta} />
			{:else}
				<p class="muted empty">Nothing open. Anything you mention on a call lands here.</p>
			{/each}
		</section>
	{/if}
</main>

<style>
	.today {
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
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.card.brand {
		background: var(--brand-soft);
		border-color: color-mix(in srgb, var(--brand) 70%, transparent);
	}

	.big {
		color: var(--text);
		font-size: var(--font-size-2xl);
		font-weight: var(--weight-semibold);
		line-height: var(--line-tight);
		letter-spacing: var(--tracking-tight);
		font-variant-numeric: tabular-nums;
	}
	.actions {
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
	.small {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-target);
		color: var(--brand);
		font-size: var(--font-size-sm);
		text-decoration: none;
	}
	.small:hover {
		text-decoration: underline;
	}

	.live-title {
		color: var(--text);
		font-size: var(--font-size-xl);
		font-weight: var(--weight-semibold);
		line-height: var(--line-snug);
	}
	.live-head {
		gap: var(--space-2);
	}
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}
	.step {
		gap: var(--space-3);
		min-height: 2.25rem;
	}
	.step-mark {
		width: 1rem;
		display: inline-flex;
		justify-content: center;
		color: var(--brand);
	}
	.step-label {
		flex: 1;
		color: var(--text);
		font-size: var(--font-size-sm);
	}
	.step.now .step-label {
		font-weight: var(--weight-semibold);
	}
	.step.todo .step-label {
		color: var(--text-muted);
	}
	.ring {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 1.5px solid var(--border-strong);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.empty {
		padding: var(--space-3) 0;
		border-top: 1px solid var(--border);
	}
	.after-list {
		margin-top: var(--space-2);
	}

	.last {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.headline {
		margin: 0;
		color: var(--text);
		font-size: var(--font-size-base);
		line-height: var(--line-snug);
	}
	.lines {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3) 0;
		border-top: 1px solid var(--border);
	}
	.line {
		gap: var(--space-3);
	}
	.line-label {
		width: 5.5rem;
		flex: none;
	}
	.line-text {
		flex: 1;
		color: var(--text);
		font-size: var(--font-size-sm);
	}

	/* The skeleton keeps the final layout, so nothing jumps when data lands. */
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.bone {
		display: block;
		background: color-mix(in srgb, var(--text) 8%, transparent);
		border-radius: var(--radius-sm);
		animation: pulse 1.2s ease-in-out infinite;
	}
	.bone-line {
		height: 0.875rem;
	}
	.bone-title {
		height: 2rem;
		width: 40%;
	}
	.bone-card {
		height: 7.5rem;
		border-radius: var(--radius-lg);
	}
	.bone-card.short {
		height: 5rem;
	}
	.w-12 {
		width: 30%;
	}
	.w-10 {
		width: 80%;
	}
	.w-9 {
		width: 65%;
	}
	.w-8 {
		width: 50%;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.55;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bone {
			animation: none;
		}
	}
</style>
