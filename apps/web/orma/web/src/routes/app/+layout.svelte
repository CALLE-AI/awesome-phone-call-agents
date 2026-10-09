<script lang="ts">
	import { goto, invalidate } from '$app/navigation'
	import { page } from '$app/state'
	import { AccountMenu, TabBar, Wordmark } from '$lib/shell'
	import { getSupabase } from '$lib/supabase'
	import { AppNav, Button } from '$lib/ui'
	import { isOnboardingPath } from './onboarding/profile-gate'

	let { data, children } = $props()

	let displayName = $state('')
	const onboarding = $derived(isOnboardingPath(page.url.pathname))

	$effect(() => {
		const userId = data.session?.user.id
		if (!userId || onboarding) return
		let stale = false
		void getSupabase()
			.from('profiles')
			.select('display_name')
			.eq('id', userId)
			.maybeSingle()
			.then(({ data: row }) => {
				if (!stale) displayName = row?.display_name ?? ''
			})
		return () => {
			stale = true
		}
	})

	async function signOut() {
		await getSupabase().auth.signOut()
		await invalidate('supabase:auth')
		await goto('/')
	}
</script>

<!-- Onboarding keeps the minimal header the design shows. -->
{#if onboarding}
	<div class="o-plain">
		<header class="o-plain-head">
			<a class="o-plain-brand" href="/">
				<Wordmark height="1.75rem" />
			</a>
			{#if data.session}
				<Button variant="ghost" onclick={signOut}>Sign out</Button>
			{/if}
		</header>
		{@render children()}
	</div>
{:else}
	<div class="o-shell">
		<aside class="o-side">
			<div class="o-side-brand">
				<a class="o-side-mark" href="/app">
					<Wordmark height="2rem" />
				</a>
				<p class="o-side-gloss">ഓർമ്മ · it remembers</p>
			</div>
			<div class="o-side-nav">
				<AppNav path={page.url.pathname} />
			</div>
			<div class="o-side-account">
				<AccountMenu name={displayName} onsignout={signOut} />
			</div>
		</aside>
		<div class="o-content">
			{@render children()}
		</div>
		<TabBar path={page.url.pathname} />
	</div>
{/if}

<style>
	/*
	 * The phone frame. A sticky header over the content, and the tab bar
	 * pinned to the bottom edge. The content carries the clearance the tab
	 * bar needs, and the pages carry their own gutters.
	 */
	.o-shell {
		--tabbar-height: 3.5rem;
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	.o-side {
		position: sticky;
		top: 0;
		z-index: 3;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-2) var(--space-4);
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	.o-side-brand {
		display: flex;
		align-items: center;
	}
	.o-side-mark {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-target);
		border-radius: var(--radius-sm);
	}
	/* The phone keeps the wordmark alone. The design shows the gloss on the desk. */
	.o-side-gloss,
	.o-side-nav {
		display: none;
	}
	.o-content {
		flex: 1;
		min-width: 0;
		padding-bottom: calc(var(--tabbar-height) + env(safe-area-inset-bottom) + var(--space-6));
	}

	/* From the sidebar width the header becomes a column and the tabs go with it. */
	@media (min-width: 900px) {
		.o-shell {
			display: grid;
			grid-template-columns: 248px minmax(0, 1fr);
		}
		.o-side {
			position: sticky;
			align-self: start;
			height: 100dvh;
			flex-direction: column;
			align-items: stretch;
			justify-content: flex-start;
			gap: var(--space-8);
			padding: var(--space-10) var(--space-5);
			border-bottom: 0;
			border-right: 1px solid var(--border);
		}
		.o-side-brand {
			flex-direction: column;
			align-items: flex-start;
			gap: var(--space-1);
			padding: 0 var(--space-3);
		}
		.o-side-gloss {
			display: block;
			color: var(--text-muted);
			font-size: var(--font-size-sm);
		}
		.o-side-nav {
			display: block;
		}
		.o-side-account {
			margin-top: auto;
			padding: 0 var(--space-3) var(--space-2);
		}
		.o-content {
			padding-bottom: 0;
		}
	}

	/* Onboarding keeps a narrow centred header above its own narrow column. */
	.o-plain {
		min-height: 100dvh;
	}
	.o-plain-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		max-width: 24rem;
		margin: 0 auto;
		padding: var(--space-8) var(--space-6) 0;
	}
	.o-plain-brand {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-target);
		border-radius: var(--radius-sm);
	}
</style>
