<script lang="ts">
	import { invalidate } from '$app/navigation'
	import { getSupabase } from '$lib/supabase'
	import { ageLabel, itemAgeDays, mentionLabel } from '$lib/today/model'
	import { Badge, Button, SectionHeader } from '$lib/ui'
	import type { ItemRows } from './+page'

	let { data } = $props()

	const FALLBACK_ZONE = 'Asia/Kolkata'
	let now = $state(new Date())
	let newText = $state('')
	let openDetail = $state<string | null>(null)
	let editingSince = $state('')
	let busy = $state<string | null>(null)
	let message = $state('')
	let tab = $state<'open' | 'retired'>('open')

	const rows = $derived(data.rows)
	const zone = $derived(rows?.profile?.timezone || FALLBACK_ZONE)
	const counts = $derived.by(() => {
		const result = new Map<string, number>()
		for (const mention of rows?.mentions ?? []) result.set(mention.item_id, (result.get(mention.item_id) ?? 0) + 1)
		return result
	})
	const openItems = $derived((rows?.items ?? []).filter((item) => item.status === 'open'))
	const retiredItems = $derived(
		(rows?.items ?? [])
			.filter((item) => item.status === 'retired')
			.toSorted((a, b) => (b.retired_at ?? '').localeCompare(a.retired_at ?? ''))
	)

	function itemMeta(item: ItemRows['items'][number]): string {
		const count = counts.get(item.id) ?? 0
		return `${mentionLabel(count)} · ${ageLabel(itemAgeDays(item, zone, now))}`
	}

	function sourceLabel(source: string): string | null {
		return ({ call: 'from the call', telegram: 'from Telegram', mcp: 'from an agent' })[source] ?? null
	}

	function openEditor(item: ItemRows['items'][number]) {
		openDetail = item.id
		editingSince = item.since_date ?? ''
		message = ''
	}

	async function addItem() {
		if (!rows) return
		const text = newText.trim()
		if (!text) return
		busy = 'add'
		message = ''
		const { error } = await getSupabase().from('items').insert({ user_id: rows.userId, text, source: 'web' })
		busy = null
		if (error) {
			message = `Could not add this item: ${error.message}`
			return
		}
		newText = ''
		message = 'Added.'
		await invalidate('orma:items')
	}

	async function saveSince(id: string) {
		if (editingSince && !/^\d{4}-\d{2}-\d{2}$/.test(editingSince)) {
			message = 'Enter the date as YYYY-MM-DD.'
			return
		}
		busy = id
		message = ''
		const { error } = await getSupabase().from('items').update({ since_date: editingSince || null }).eq('id', id)
		busy = null
		if (error) {
			message = `Could not save the date: ${error.message}`
			return
		}
		message = 'Since date saved.'
		await invalidate('orma:items')
	}

	async function retire(id: string) {
		busy = id
		message = ''
		const { error } = await getSupabase()
			.from('items')
			.update({ status: 'retired', retired_at: new Date().toISOString(), retired_reason: 'retired here' })
			.eq('id', id)
		busy = null
		if (error) {
			message = `Could not retire this item: ${error.message}`
			return
		}
		openDetail = null
		message = 'Retired. You can restore it whenever you want.'
		await invalidate('orma:items')
	}

	async function restore(id: string) {
		busy = id
		message = ''
		const { error } = await getSupabase()
			.from('items')
			.update({ status: 'open', retired_at: null, retired_reason: null })
			.eq('id', id)
		busy = null
		if (error) {
			message = `Could not restore this item: ${error.message}`
			return
		}
		message = 'Restored to your open items.'
		await invalidate('orma:items')
	}
</script>

<svelte:head><title>Items · Orma</title></svelte:head>

<main class="items">
	{#if data.error || !rows}
		<section class="head">
			<h1>Items</h1>
			<p class="hint" role="alert">{data.error || 'Could not load your items.'}</p>
		</section>
	{:else}
		<section class="head">
			<h1>Items</h1>
			<form
				class="add"
				onsubmit={(event) => {
					event.preventDefault()
					void addItem()
				}}
			>
				<label class="sr-only" for="new-item">Add something to keep track of</label>
				<input id="new-item" bind:value={newText} placeholder="Add something to keep track of" maxlength="500" />
				<Button type="submit" disabled={busy === 'add' || !newText.trim()}>
					{busy === 'add' ? 'Adding…' : 'Add'}
				</Button>
			</form>
			{#if message}<p class="hint status" role="status">{message}</p>{/if}
		</section>

		<div class="tabs" role="tablist" aria-label="Item lists">
			<button
				class="tab"
				class:on={tab === 'open'}
				role="tab"
				aria-selected={tab === 'open'}
				type="button"
				onclick={() => (tab = 'open')}
			>
				Open · {openItems.length}
			</button>
			<button
				class="tab"
				class:on={tab === 'retired'}
				role="tab"
				aria-selected={tab === 'retired'}
				type="button"
				onclick={() => (tab = 'retired')}
			>
				Retired · {retiredItems.length}
			</button>
		</div>

		{#if tab === 'open'}
			<section class="list">
				<SectionHeader title="Open · {openItems.length}" hint="Counts come from the calls" />
				{#each openItems as item (item.id)}
					<div class="item">
						<div class="item-top">
							<div class="copy">
								<span class="text">{item.text}</span>
								<span class="muted meta">
									{itemMeta(item)}
									{#if sourceLabel(item.source)}<Badge>{sourceLabel(item.source)}</Badge>{/if}
								</span>
							</div>
							<Button
								variant="ghost"
								onclick={() =>
									openDetail === item.id ? (openDetail = null) : openEditor(item)}
								ariaExpanded={openDetail === item.id}
							>
								{openDetail === item.id ? 'Close' : 'Details'}
							</Button>
						</div>
						{#if openDetail === item.id}
							<div class="detail">
								<div class="field">
									<span class="field-label" id={`since-label-${item.id}`}>Since</span>
									<span class="row date-row">
										<input
											id={`since-${item.id}`}
											type="date"
											aria-labelledby={`since-label-${item.id}`}
											bind:value={editingSince}
										/>
										<Button
											variant="secondary"
											type="button"
											onclick={() => void saveSince(item.id)}
											disabled={busy === item.id}
										>
											Save
										</Button>
									</span>
									<span class="hint">Orma counts the age from this date. Leave it empty to count from when you added it.</span>
								</div>
								<div class="row detail-actions">
									<Button
										variant="secondary"
										type="button"
										onclick={() => void retire(item.id)}
										disabled={busy === item.id}
									>
										Retire
									</Button>
									<span class="hint">{counts.get(item.id) ?? 0} recorded mentions</span>
								</div>
							</div>
						{:else}
							<span class="retire">
								<Button
									variant="ghost"
									type="button"
									onclick={() => void retire(item.id)}
									disabled={busy === item.id}
								>
									Retire
								</Button>
							</span>
						{/if}
					</div>
				{:else}
					<p class="hint empty">Nothing is open yet. Add something you want Orma to remember.</p>
				{/each}
			</section>
		{:else}
			<section class="list">
				<SectionHeader title="Retired · {retiredItems.length}" />
				{#each retiredItems as item (item.id)}
					<div class="item retired">
						<div class="item-top">
							<div class="copy">
								<span class="text">{item.text} {#if item.seeded}<Badge>seeded</Badge>{/if}</span>
								<span class="muted meta">{item.retired_reason || 'Retired'} · {itemMeta(item)}</span>
							</div>
							<Button
								variant="ghost"
								type="button"
								onclick={() => void restore(item.id)}
								disabled={busy === item.id}
							>
								Restore
							</Button>
						</div>
					</div>
				{:else}
					<p class="hint empty">Nothing retired.</p>
				{/each}
				<p class="hint after-list">Retiring is never a failure. Restore brings an item back with its history.</p>
			</section>
		{/if}
	{/if}
</main>

<style>
	.items {
		width: 100%;
		max-width: 40rem;
		margin: 0 auto;
		padding: var(--space-8) var(--space-5) var(--space-12);
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	h1 {
		margin: 0;
		color: var(--text);
		font-size: var(--font-size-2xl);
		font-weight: var(--weight-bold);
		line-height: var(--line-tight);
		letter-spacing: var(--tracking-tight);
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
	}
	.status {
		color: var(--text);
	}
	.muted {
		color: var(--text-muted);
	}
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.add {
		display: flex;
		gap: var(--space-2);
	}
	.add input {
		flex: 1;
		min-width: 0;
	}

	input {
		min-height: var(--tap-target);
		padding: var(--space-2) var(--space-3);
		background: var(--surface-raised);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		color: var(--text);
		font: inherit;
	}

	.tabs {
		display: flex;
		gap: var(--space-1);
		border-bottom: 1px solid var(--border);
	}
	.tab {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap-target);
		padding: 0 var(--space-3);
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--text-muted);
		font: inherit;
		font-size: var(--font-size-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}
	.tab.on {
		color: var(--brand);
		border-bottom-color: var(--brand);
		font-weight: var(--weight-semibold);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.item {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--border);
		padding: var(--space-3) 0;
	}
	.item-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-3);
	}
	.copy {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.text {
		color: var(--text);
		font-size: var(--font-size-base);
		line-height: var(--line-snug);
	}
	.meta {
		font-size: var(--font-size-sm);
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.retire {
		margin-left: auto;
	}

	.detail {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-3);
		padding: var(--space-4);
		background: var(--brand-soft);
		border-radius: var(--radius-md);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.field-label {
		color: var(--text);
		font-size: var(--font-size-sm);
		font-weight: var(--weight-semibold);
	}
	.date-row input {
		flex: 1;
		min-width: 0;
	}
	.detail-actions {
		justify-content: space-between;
	}

	.after-list {
		margin-top: var(--space-1);
	}
	.empty {
		border-top: 1px solid var(--border);
		padding-top: var(--space-3);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
