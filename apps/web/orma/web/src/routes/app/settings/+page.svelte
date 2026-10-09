<script lang="ts">
	import { goto, invalidate } from '$app/navigation'
	import { onMount } from 'svelte'
	import { ORMA_API_URL, TELEGRAM_BOT_USERNAME, loadTelegramLinkState, mintLinkToken, unlinkTelegram } from '$lib/telegram-link'
	import { getPublishableKey, getSession, getSupabase, postAuthTelegram, sessionTokensFromUnknown, type TelegramWidgetUser } from '$lib/supabase'
	import { CONSENT_KIND_OUTBOUND, CONSENT_SOURCE, consentTextVersion, DEFAULT_TIMEZONE, isE164, normalizePhone, partOfDayFromHour } from '../onboarding/model'
	import { Button, SectionHeader } from '$lib/ui'
	import PhoneConfirm from '$lib/phone-confirm/PhoneConfirm.svelte'

	let { data } = $props()
	type Slot = { id: string; local_time: string; weekdays: number[]; active: boolean; part_of_day: string }
	type Run = { id: string; local_date: string; scheduled_for: string }
	const WEEKDAYS = [{n:1,label:'M'},{n:2,label:'T'},{n:3,label:'W'},{n:4,label:'T'},{n:5,label:'F'},{n:6,label:'S'},{n:7,label:'S'}]
	const timeZones = zones()
	let displayName = $state(''); let phone = $state(''); let savedPhone = $state(''); let phoneConfirmedAt = $state<string | null>(null); let timezone = $state(DEFAULT_TIMEZONE)
	let emailReceipts = $state(false); let telegramReceipts = $state(true); let consented = $state(false)
	let slots = $state<Slot[]>([]); let runs = $state<Run[]>([]); let loaded = $state(false)
	let deepLink = $state(''); let telegramChatId = $state<number | null>(null); let attachedTelegramId = $state<string | null>(null); let attachedTelegramName = $state('')
	let status = $state(''); let error = $state(''); let busy = $state(false); let deleting = $state(false); let deleteConfirmation = $state(''); let widgetHost: HTMLDivElement | undefined = $state()
	const phoneOk = $derived(isE164(phone)); const today = $derived(dateInZone(new Date(), timezone)); const todaysRuns = $derived(runs.filter((run) => run.local_date === today))

	function zones() { try { const value = [...Intl.supportedValuesOf('timeZone')]; if (!value.includes(DEFAULT_TIMEZONE)) value.unshift(DEFAULT_TIMEZONE); return value } catch { return [DEFAULT_TIMEZONE, 'UTC', 'Europe/London', 'America/New_York', 'Asia/Singapore', 'Asia/Tokyo'] } }
	function dateInZone(at: Date, zone: string) { try { return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at) } catch { return new Intl.DateTimeFormat('en-CA',{timeZone:DEFAULT_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(at) } }
	function telegramId(value: unknown) { return typeof value === 'number' && Number.isInteger(value) && value > 0 ? String(value) : typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? value : null }
	async function session() { const live = await getSession(); const accessToken = live?.access_token ?? data.session?.access_token ?? ''; const userId = live?.user.id ?? data.session?.user.id ?? ''; if (!accessToken || !userId) throw new Error('Sign in, then return to Settings.'); const id = telegramId((live?.user.app_metadata ?? data.session?.user.app_metadata ?? {}).telegram_user_id); if (id) attachedTelegramId = id; return {accessToken,userId} }
	async function telegramCreds() { const {accessToken,userId} = await session(); return {apiUrl:ORMA_API_URL,accessToken,userId,anonKey:getPublishableKey()} }
	function failure(err: unknown, fallback: string) { error = err instanceof Error ? err.message : fallback }

	async function loadSettings() { error = ''; try { const {userId} = await session(); const client = getSupabase(); const [profile, consent, slot, run, telegram] = await Promise.all([client.from('profiles').select('display_name,phone_e164,phone_confirmed_at,timezone,email_receipts,telegram_receipts').eq('id',userId).single(),client.from('consents').select('id').eq('user_id',userId).eq('kind',CONSENT_KIND_OUTBOUND).is('revoked_at',null).limit(1),client.from('slots').select('id,local_time,weekdays,active,part_of_day').eq('user_id',userId).order('local_time'),client.from('call_runs').select('id,local_date,scheduled_for').eq('user_id',userId).eq('state','scheduled').order('scheduled_for'),loadTelegramLinkState(await telegramCreds())]); if(profile.error) throw profile.error; if(consent.error) throw consent.error; if(slot.error) throw slot.error; if(run.error) throw run.error; displayName=profile.data.display_name; phone=profile.data.phone_e164 ?? ''; savedPhone=profile.data.phone_e164 ?? ''; phoneConfirmedAt=profile.data.phone_confirmed_at; timezone=profile.data.timezone; emailReceipts=profile.data.email_receipts; telegramReceipts=profile.data.telegram_receipts; consented=consent.data.length>0; slots=slot.data as Slot[]; runs=run.data as Run[]; telegramChatId=telegram.telegramChatId; loaded=true } catch(err) { failure(err,'Could not load Settings.') } }
	async function saveProfile(event: SubmitEvent) { event.preventDefault(); error=''; status=''; if(!displayName.trim()) { error='Enter the name Orma should say.'; return } if(!phoneOk) { error='Enter a phone number in international format, starting with +.'; return } busy=true; try { const {userId}=await session(); const nextPhone=normalizePhone(phone); const changed=nextPhone!==savedPhone; const {error:problem}=await getSupabase().from('profiles').update({display_name:displayName.trim(),phone_e164:nextPhone,timezone,email_receipts:emailReceipts,telegram_receipts:telegramReceipts}).eq('id',userId); if(problem) throw problem; savedPhone=nextPhone; if(changed) phoneConfirmedAt=null; status=changed?'Settings saved. Confirm this new number before Orma can call it.':'Settings saved.'; await invalidate('orma:today') } catch(err) { failure(err,'Could not save Settings.') } finally { busy=false } }
	async function setConsent(next: boolean) { error=''; status=''; busy=true; try { const {userId}=await session(); const client=getSupabase(); if(next) { if(!phoneOk) throw new Error('Save a valid phone number before turning calls on.'); const {error:problem}=await client.from('consents').insert({user_id:userId,kind:CONSENT_KIND_OUTBOUND,text_version:consentTextVersion(normalizePhone(phone)),source:CONSENT_SOURCE}); if(problem) throw problem; consented=true; status='Calls are on. Orma may dispatch the next scheduled call.' } else { const {error:problem}=await client.from('consents').update({revoked_at:new Date().toISOString()}).eq('user_id',userId).eq('kind',CONSENT_KIND_OUTBOUND).is('revoked_at',null); if(problem) throw problem; consented=false; status='Calls are off. Orma cannot dispatch a call until you agree again.' } } catch(err) { failure(err,'Could not change call permission.') } finally { busy=false } }
	async function setSlotsActive(active: boolean) { error=''; status=''; busy=true; try { const {userId}=await session(); const {error:problem}=await getSupabase().from('slots').update({active}).eq('user_id',userId); if(problem) throw problem; slots=slots.map((slot)=>({...slot,active})); status=active?'Calls resumed at every saved time.':'Every saved call time is paused. Future runs will be removed by the materialiser.'; await invalidate('orma:today') } catch(err) { failure(err,'Could not update call times.') } finally { busy=false } }
	async function cancelRun(id: string) { error=''; status=''; busy=true; try { const {data:cancelled,error:problem}=await getSupabase().rpc('cancel_call_run',{run_id:id}); if(problem) throw problem; if(!cancelled) throw new Error('That call was already claimed or is no longer scheduled.'); runs=runs.filter((run)=>run.id!==id); status='Today’s call is cancelled. It will not ring.'; await invalidate('orma:today') } catch(err) { failure(err,'Could not cancel this call.') } finally { busy=false } }
	async function addSlot() { error=''; status=''; busy=true; try { const {userId}=await session(); const {data:slot,error:problem}=await getSupabase().from('slots').insert({user_id:userId,local_time:'08:00',weekdays:[1,2,3,4,5,6,7],part_of_day:'morning',active:true}).select('id,local_time,weekdays,active,part_of_day').single(); if(problem) throw problem; slots=[...slots,slot as Slot]; status='A new call time was added. Choose its details, then save it.' } catch(err) { failure(err,'Could not add a call time.') } finally { busy=false } }
	function toggleDay(slot: Slot, day: number) { const weekdays=slot.weekdays.includes(day)?slot.weekdays.filter((item)=>item!==day):[...slot.weekdays,day].sort((a,b)=>a-b); if(weekdays.length) slots=slots.map((item)=>item.id===slot.id?{...item,weekdays}:item) }
	async function saveSlot(slot: Slot) { error=''; status=''; busy=true; try { const hour=Number(slot.local_time.slice(0,2)); const {error:problem}=await getSupabase().from('slots').update({local_time:slot.local_time,weekdays:slot.weekdays,active:slot.active,part_of_day:partOfDayFromHour(hour)}).eq('id',slot.id); if(problem) throw problem; status='Call time saved.'; await invalidate('orma:today') } catch(err) { failure(err,'Could not save this call time.') } finally { busy=false } }
	async function removeSlot(id: string) { error=''; status=''; busy=true; try { const {error:problem}=await getSupabase().from('slots').delete().eq('id',id); if(problem) throw problem; slots=slots.filter((slot)=>slot.id!==id); status='Call time removed.'; await invalidate('orma:today') } catch(err) { failure(err,'Could not remove this call time.') } finally { busy=false } }
	async function refreshTelegram() { error=''; status=''; busy=true; try { const value=await loadTelegramLinkState(await telegramCreds()); telegramChatId=value.telegramChatId; status=telegramChatId===null?'Bot chat is not linked.':`Linked chat ${telegramChatId}.` } catch(err) { failure(err,'Could not read link state.') } finally { busy=false } }
	async function mint() { error=''; status=''; busy=true; try { deepLink=(await mintLinkToken(await telegramCreds())).deepLink; status='Open this link in Telegram. One Start press binds this chat.' } catch(err) { failure(err,'Mint failed.') } finally { busy=false } }
	async function unlink() { error=''; status=''; busy=true; try { await unlinkTelegram(await telegramCreds()); deepLink=''; telegramChatId=null; status='Bot chat is unlinked. Tokens and chat id are cleared.' } catch(err) { failure(err,'Unlink failed.') } finally { busy=false } }
	async function attachTelegram(user: TelegramWidgetUser) { error=''; status=''; busy=true; try { const {accessToken}=await session(); const tokens=sessionTokensFromUnknown(await postAuthTelegram(user,{accessToken})); if(!tokens) throw new Error('Telegram attach returned no session'); const {error:problem}=await getSupabase().auth.setSession(tokens); if(problem) throw problem; attachedTelegramId=String(user.id); attachedTelegramName=[user.first_name,user.last_name].filter(Boolean).join(' '); status='Telegram identity is attached to this account.' } catch(err) { failure(err,'Telegram attach failed.') } finally { busy=false } }
	async function deleteAccount() { if(deleteConfirmation!=='DELETE') return; error=''; busy=true; try { const {data:deleted,error:problem}=await getSupabase().rpc('delete_my_account'); if(problem) throw problem; if(!deleted) throw new Error('The account could not be deleted.'); await getSupabase().auth.signOut(); await goto('/') } catch(err) { failure(err,'Could not delete this account.') } finally { busy=false } }
	onMount(()=>{ void loadSettings(); const host=widgetHost; if(!host) return; const win=window as Window & {onTelegramAuth?: (user:TelegramWidgetUser)=>void}; win.onTelegramAuth=(user)=>void attachTelegram(user); const script=document.createElement('script'); script.async=true; script.src='https://telegram.org/js/telegram-widget.js?22'; script.setAttribute('data-telegram-login',TELEGRAM_BOT_USERNAME); script.setAttribute('data-size','large'); script.setAttribute('data-radius','true'); script.setAttribute('data-request-access','write'); script.setAttribute('data-onauth','onTelegramAuth(user)'); host.replaceChildren(script); return ()=>{win.onTelegramAuth=undefined;host.replaceChildren()} })
</script>

<svelte:head><title>Settings · Orma</title></svelte:head>
<main class="settings">
	<header class="head">
		<span class="label">Account</span>
		<h1>Settings</h1>
		<p class="hint">You are always in control of whether Orma can call.</p>
	</header>
	{#if !loaded}<p class="hint">Loading your settings…</p>{:else}
		<form class="cards" onsubmit={saveProfile}>
			<section class="card">
				<SectionHeader title="Your call" />
				<label class="field"><span>Name</span><input bind:value={displayName} autocomplete="name" required /></label>
				<label class="field"><span>Phone</span><input class:bad={phone.length>0&&!phoneOk} type="tel" bind:value={phone} autocomplete="tel" /></label>
				<p class:confirmed={Boolean(phoneConfirmedAt)} class="hint">{phoneConfirmedAt ? 'Confirmed. Orma can call this number when you have given consent.' : 'Not confirmed. Orma will not place daily calls until you enter a code from one confirmation call.'}</p>
				<label class="field"><span>Time zone</span><select bind:value={timezone}>{#each timeZones as zone (zone)}<option value={zone}>{zone}</option>{/each}</select></label>
				<div><Button type="submit" disabled={busy}>Save settings</Button></div>
				{#if !phoneConfirmedAt && savedPhone && phone === savedPhone}
					<PhoneConfirm onverified={async () => { phoneConfirmedAt = new Date().toISOString(); status = 'Number confirmed. Orma can call this number when you have given consent.'; await invalidate('orma:today') }} />
				{:else if phone !== savedPhone}
					<p class="hint">Save this number, then confirm it with a code call.</p>
				{/if}
			</section>

			<section class="card">
				<SectionHeader title="Receipts" />
				<label class="check"><input type="checkbox" bind:checked={emailReceipts} /> Email after each call</label>
				<label class="check"><input type="checkbox" bind:checked={telegramReceipts} /> Telegram after each call</label>
				<p class="hint">Receipts report on a call that already happened. They never remind you.</p>
			</section>
		</form>

		<section class="card">
			<SectionHeader title="Call permission" />
			<p class="body">{consented?'Orma has your permission to call at the times below.':'Calls are off. Orma cannot dispatch a call until you agree.'}</p>
			<div>
				<Button variant={consented?'secondary':'primary'} type="button" onclick={()=>setConsent(!consented)} disabled={busy}>
					{consented?'Turn calls off':'I agree to calls'}
				</Button>
			</div>
			<p class="hint">Turning calls off revokes consent now. The next dispatch tick will not ring you.</p>
		</section>

		<section class="card">
			<div class="card-head">
				<SectionHeader title="Call times" />
				<Button variant="ghost" type="button" onclick={addSlot} disabled={busy}>Add a time</Button>
			</div>
			{#each slots as slot (slot.id)}
				<article class="slot">
					<div class="row split">
						<label class="field compact"><span>Time</span><input type="time" value={slot.local_time.slice(0,5)} onchange={(event)=>slots=slots.map((item)=>item.id===slot.id?{...item,local_time:event.currentTarget.value}:item)} /></label>
						<label class="check"><input type="checkbox" checked={slot.active} onchange={(event)=>slots=slots.map((item)=>item.id===slot.id?{...item,active:event.currentTarget.checked}:item)} /> Active</label>
					</div>
					<div class="days">
						{#each WEEKDAYS as day (day.n)}
							<button class:chosen={slot.weekdays.includes(day.n)} type="button" aria-pressed={slot.weekdays.includes(day.n)} onclick={()=>toggleDay(slot,day.n)}>{day.label}</button>
						{/each}
					</div>
					<div class="row actions">
						<Button variant="secondary" type="button" onclick={()=>saveSlot(slot)} disabled={busy}>Save time</Button>
						<Button variant="ghost" type="button" onclick={()=>removeSlot(slot.id)} disabled={busy}>Remove</Button>
					</div>
				</article>
			{/each}
		</section>

		<section class="card">
			<SectionHeader title="Telegram" hint="Sign-in identity and bot messages are separate." />
			<div class="widget" bind:this={widgetHost}></div>
			{#if attachedTelegramId}<p class="body">Telegram identity is attached{attachedTelegramName?` (${attachedTelegramName})`:''}.</p>{/if}
			<div class="row actions">
				<Button variant="secondary" type="button" onclick={refreshTelegram} disabled={busy}>Refresh bot chat</Button>
				<Button variant="ghost" type="button" onclick={mint} disabled={busy}>Mint Start link</Button>
				<Button variant="ghost" type="button" onclick={unlink} disabled={busy}>Unlink bot chat</Button>
			</div>
			{#if deepLink}<a class="deeplink" href={deepLink}>{deepLink}</a>{/if}
			{#if telegramChatId}<p class="hint">Linked chat {telegramChatId}.</p>{/if}
		</section>

		<section class="card danger">
			<SectionHeader title="Danger zone" />
			<div class="zone-block">
				<p class="body">Pause every saved call time.</p>
				<div class="row actions">
					<Button variant="secondary" type="button" onclick={()=>setSlotsActive(false)} disabled={busy}>Pause all calls</Button>
					<Button variant="ghost" type="button" onclick={()=>setSlotsActive(true)} disabled={busy}>Resume all</Button>
				</div>
				<p class="hint">Pausing makes every saved time inactive. The materialiser removes future calls from inactive times.</p>
			</div>
			<div class="zone-block">
				<p class="body">Today’s call</p>
				{#each todaysRuns as run (run.id)}
					<article class="row split call">
						<span>{new Intl.DateTimeFormat(undefined,{timeZone:timezone,hour:'numeric',minute:'2-digit'}).format(new Date(run.scheduled_for))}</span>
						<Button variant="secondary" type="button" onclick={()=>cancelRun(run.id)} disabled={busy}>Cancel this call</Button>
					</article>
				{:else}
					<p class="hint">There is no scheduled call today.</p>
				{/each}
				<p class="hint">Cancellation only applies while a call is scheduled. A claimed call may already be dispatching.</p>
			</div>
			<div class="zone-block">
				<p class="body">Deleting your account permanently removes your profile, call times, items, calls, transcripts, receipts, Telegram links, and audio. This cannot be undone.</p>
				{#if deleting}
					<label class="field"><span>Type DELETE to confirm</span><input bind:value={deleteConfirmation} autocomplete="off" /></label>
					<div class="row actions">
						<Button variant="danger" type="button" onclick={deleteAccount} disabled={busy||deleteConfirmation!=='DELETE'}>Delete everything</Button>
						<Button variant="ghost" type="button" onclick={()=>{deleting=false;deleteConfirmation=''}} disabled={busy}>Keep my account</Button>
					</div>
				{:else}
					<div>
						<Button variant="danger" type="button" onclick={()=>deleting=true}>Delete account</Button>
					</div>
				{/if}
			</div>
		</section>
	{/if}
	{#if status}<p class="notice" aria-live="polite">{status}</p>{/if}
	{#if error}<p class="hint error" role="alert">{error}</p>{/if}
</main>

<style>
	.settings {
		width: 100%;
		max-width: 44rem;
		margin: 0 auto;
		padding: var(--space-8) var(--space-5) var(--space-16);
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
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
	.body {
		margin: 0;
		color: var(--text);
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.split {
		justify-content: space-between;
	}

	.cards {
		display: contents;
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
	.card.danger {
		background: var(--danger-soft);
		border-color: color-mix(in srgb, var(--danger) 70%, transparent);
	}
	.card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-width: 28rem;
	}
	.field span {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}
	.compact {
		min-width: 10rem;
	}
	input,
	select {
		min-height: var(--tap-target);
		padding: var(--space-2) var(--space-3);
		background: var(--surface-raised);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		color: var(--text);
		font: inherit;
	}
	input.bad {
		border-color: var(--danger);
	}
	.check {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		min-height: var(--tap-target);
		color: var(--text);
		font-size: var(--font-size-sm);
	}
	.check input {
		width: 1.5rem;
		height: 1.5rem;
		accent-color: var(--brand);
	}
	.actions {
		gap: var(--space-2);
		flex-wrap: wrap;
	}

	.slot {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}
	.days {
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
	}
	.days button {
		width: 2.75rem;
		height: 2.75rem;
		border: 1px solid var(--border-strong);
		background: transparent;
		color: var(--text);
		border-radius: 50%;
		font: inherit;
		font-size: var(--font-size-sm);
		cursor: pointer;
	}
	.days button.chosen {
		background: var(--brand);
		color: var(--brand-contrast);
		border-color: var(--brand);
		font-weight: var(--weight-semibold);
	}

	.call {
		justify-content: space-between;
		padding: var(--space-3) var(--space-4);
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--text);
		font-size: var(--font-size-sm);
	}

	.deeplink {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-target);
		color: var(--brand);
		font-size: var(--font-size-sm);
		overflow-wrap: anywhere;
	}

	.danger .zone-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
	}
	.danger .zone-block:first-of-type {
		border-top: none;
		padding-top: 0;
	}

	.notice {
		margin: 0;
		color: var(--success);
		font-size: var(--font-size-sm);
	}
	.error {
		color: var(--danger);
	}
	.confirmed { color: var(--success); }
</style>
