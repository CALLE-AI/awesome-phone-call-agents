<script lang="ts">
	import { goto } from '$app/navigation'
	import { TELEGRAM_BOT_USERNAME } from '$lib/telegram-link'
	import { getOrmaApiUrl, getPublishableKey, getSession } from '$lib/supabase'
	import {
		ALL_WEEKDAYS,
		DEFAULT_TIMEZONE,
		WEEKDAY_CHIPS,
		firstCallSummary,
		isE164,
		normalizePhone,
		shownConsentWording
	} from './model'
	import { submitOnboarding } from './submit'
	import { Button, Field } from '$lib/ui'
	import PhoneConfirm from '$lib/phone-confirm/PhoneConfirm.svelte'

	let { data } = $props()

	let displayName = $state('')
	let phone = $state('')
	let agreed = $state(false)
	let localTime = $state('08:00')
	let weekdays = $state<number[]>([...ALL_WEEKDAYS])
	let timeZone = $state(DEFAULT_TIMEZONE)
	let busy = $state(false)
	let error = $state('')
	let step = $state(0)
	let saved = $state(false)

	const LAST = 6

	const timeZones = listTimeZones()
	const phoneE164 = $derived(normalizePhone(phone))
	const phoneOk = $derived(isE164(phone))
	const consentWording = $derived(shownConsentWording(phoneOk ? phoneE164 : 'your number'))
	const callSummary = $derived(
		firstCallSummary({
			localTime,
			weekdays,
			timeZone
		})
	)

	/* A step opens only when its question is answered, so no half form submits. */
	const canAdvance = $derived(
		step === 0 ? displayName.trim().length > 0 : step === 1 ? phoneOk : true
	)

	function go(n: number) {
		error = ''
		step = Math.max(0, Math.min(LAST, n))
	}

	function listTimeZones(): string[] {
		try {
			const zones = [...Intl.supportedValuesOf('timeZone')]
			if (!zones.includes(DEFAULT_TIMEZONE)) zones.unshift(DEFAULT_TIMEZONE)
			return zones
		} catch {
			return [
				DEFAULT_TIMEZONE,
				'UTC',
				'Europe/London',
				'Europe/Paris',
				'America/New_York',
				'America/Chicago',
				'America/Denver',
				'America/Los_Angeles',
				'America/Sao_Paulo',
				'Africa/Johannesburg',
				'Asia/Dubai',
				'Asia/Singapore',
				'Asia/Tokyo',
				'Australia/Sydney',
				'Pacific/Auckland'
			]
		}
	}

	function toggleDay(day: number) {
		if (weekdays.includes(day)) {
			if (weekdays.length === 1) return
			weekdays = weekdays.filter((n) => n !== day)
			return
		}
		weekdays = [...weekdays, day].sort((a, b) => a - b)
	}

	async function startCalls(event: Event) {
		event.preventDefault()
		error = ''
		busy = true
		try {
			const live = await getSession()
			const accessToken = live?.access_token ?? data.session?.access_token ?? ''
			const userId = live?.user.id ?? data.session?.user.id ?? ''
			if (!accessToken || !userId) {
				throw new Error('Sign in, then return to onboarding.')
			}
			await submitOnboarding(
				{
					apiUrl: getOrmaApiUrl(),
					accessToken,
					userId,
					anonKey: getPublishableKey()
				},
				{
					displayName,
					phone,
					agreed,
					localTime,
					weekdays,
					timeZone
				}
			)
			saved = true
			step = LAST
		} catch (err) {
			error = err instanceof Error ? err.message : 'Could not save onboarding'
		} finally {
			busy = false
		}
	}
</script>

<svelte:head>
	<title>Set up your call · Orma</title>
</svelte:head>

<main>
	<header>
		<h1>Set up your call</h1>
		<p class="gloss">One short setup, then one code call.</p>
	</header>

	<div class="progress" role="progressbar" aria-valuemin={1} aria-valuemax={7} aria-valuenow={step + 1} aria-label="Step {step + 1} of 7">
		{#each Array(7) as _, i}
			<span class="seg" class:on={i <= step}></span>
		{/each}
	</div>
	<p class="count">Step {step + 1} of 7</p>

	<form class="flow" onsubmit={startCalls}>
		{#if step === 0}
			<section class="card">
				<h2>Your name</h2>
				<Field label="Your name">
					<input
						type="text"
						name="display_name"
						autocomplete="name"
						bind:value={displayName}
						required
					/>
				</Field>
				<p class="hint">Orma says it when it calls, so you know who it is for.</p>
			</section>
		{:else if step === 1}
			<section class="card">
				<h2>Your phone</h2>
				<Field label="Phone number" error={phone.length > 0 && !phoneOk ? 'Use the international format, starting with +.' : undefined}>
					<input
						type="tel"
						name="phone"
						inputmode="tel"
						autocomplete="tel"
						placeholder="+91 98765 43210"
						aria-invalid={phone.length > 0 && !phoneOk ? 'true' : undefined}
						bind:value={phone}
						required
					/>
				</Field>
				<p class="hint">In international format, starting with +. Orma calls once with a code to confirm this number. No daily call is placed until you enter it.</p>
			</section>
		{:else if step === 2}
			<section class="card">
				<h2>Your consent</h2>
				<div class="wash">
					<span class="label">Wording v1</span>
					<p>{consentWording}</p>
				</div>
				<div class="actions">
					<Button
						variant={agreed ? 'primary' : 'secondary'}
						type="button"
						ariaPressed={agreed}
						onclick={() => (agreed = true)}
					>
						I agree to these calls
					</Button>
					<Button variant="ghost" type="button" onclick={() => (agreed = false)}>
						Continue without agreeing
					</Button>
				</div>
				<p class="hint">Without this, Orma will not call. You can agree later in Settings.</p>
			</section>
		{:else if step === 3}
			<section class="card">
				<h2>When to call</h2>
				<Field label="Time">
					<input type="time" name="local_time" bind:value={localTime} required />
				</Field>
				<div class="field-block">
					<span class="field-label">Days</span>
					<div class="days">
						{#each WEEKDAY_CHIPS as day (day.n)}
							<button
								class="day"
								class:on={weekdays.includes(day.n)}
								type="button"
								aria-pressed={weekdays.includes(day.n)}
								onclick={() => toggleDay(day.n)}
							>
								{day.label}
							</button>
						{/each}
					</div>
				</div>
				<Field label="Time zone">
					<select name="timezone" bind:value={timeZone}>
						{#each timeZones as zone (zone)}
							<option value={zone}>{zone}</option>
						{/each}
					</select>
				</Field>
			</section>
		{:else if step === 4}
			<section class="card">
				<h2>Receipts on Telegram</h2>
				<p class="body">After each call, Orma can send what it captured. One Start press lets the bot message you.</p>
				<div class="actions">
					<Button variant="secondary" href="https://t.me/{TELEGRAM_BOT_USERNAME}">
						Open @{TELEGRAM_BOT_USERNAME}
					</Button>
				</div>
				<p class="hint">
					Optional. Receipts only, never reminders. After you start, Settings can mint a Start link.
				</p>
			</section>
		{:else if step === 5}
			<section class="card">
				<h2>Before the first call</h2>
				<div class="wash">
					<p class="warn-title">It will come from a number you won't recognise.</p>
					<p>
						A different one each time, and your phone may say it is likely spam. Answer it anyway. It
						is Orma.
					</p>
					<p class="hint">We cannot stop that warning, and there is no number to save.</p>
				</div>
				<p class="summary">{callSummary}</p>
			</section>
		{:else}
			<section class="card">
				<PhoneConfirm onverified={() => goto('/app')} />
				<Button variant="ghost" type="button" onclick={() => goto('/app')}>Skip for now</Button>
				<p class="hint">You can confirm later in Settings. Today will stay blocked until you do.</p>
			</section>
		{/if}

		{#if !saved}
		<div class="nav">
			{#if step > 0}
				<Button variant="secondary" type="button" onclick={() => go(step - 1)}>Back</Button>
			{/if}
			{#if step < LAST - 1}
				<Button type="button" disabled={!canAdvance} onclick={() => go(step + 1)}>Next</Button>
			{:else}
				<Button type="submit" disabled={busy}>Save and confirm number</Button>
			{/if}
		</div>
		{/if}
		{#if error}
			<p class="error" role="alert">{error}</p>
		{/if}
	</form>
</main>

<style>
	main {
		width: 100%;
		max-width: 26rem;
		margin: 0 auto;
		padding: var(--space-8) var(--space-4) var(--space-16);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	header {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	h1 {
		margin: 0;
		color: var(--text);
		font-size: var(--font-size-2xl);
		font-weight: var(--weight-bold);
		letter-spacing: var(--tracking-tight);
		line-height: var(--line-tight);
	}
	.gloss {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}

	.progress {
		display: flex;
		gap: var(--space-1);
	}
	.seg {
		flex: 1;
		height: 4px;
		background: var(--border);
		border-radius: var(--radius-pill);
		transition: background-color var(--motion-fast) ease-out;
	}
	.seg.on {
		background: var(--brand);
	}
	.count {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-6);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	h2 {
		margin: 0;
		color: var(--text);
		font-size: var(--font-size-xl);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
	}

	.hint,
	.body {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
	}

	.wash {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-4);
		background: var(--brand-soft);
		border-radius: var(--radius-md);
	}
	.wash p {
		margin: 0;
		color: var(--text);
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
	}
	.label {
		color: var(--text-muted);
		font-size: var(--font-size-xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
	}
	.warn-title {
		font-weight: var(--weight-semibold);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}

	.field-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.field-label {
		color: var(--text);
		font-size: var(--font-size-sm);
		font-weight: var(--weight-semibold);
	}
	.days {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.day {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap-target);
		padding: 0 var(--space-3);
		background: var(--surface-raised);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-pill);
		color: var(--text);
		font: inherit;
		font-size: var(--font-size-sm);
		cursor: pointer;
	}
	.day.on {
		background: var(--brand);
		border-color: var(--brand);
		color: var(--brand-contrast);
		font-weight: var(--weight-semibold);
	}

	.summary {
		margin: 0;
		padding-top: var(--space-4);
		border-top: 1px solid var(--border);
		color: var(--text);
		font-size: var(--font-size-base);
		font-weight: var(--weight-medium);
	}

	.nav {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.error {
		margin: 0;
		color: var(--danger);
		font-size: var(--font-size-sm);
	}
</style>
