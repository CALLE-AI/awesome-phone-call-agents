<script lang="ts">
	import '$lib/ui/tokens.css'
	import { goto, invalidate } from '$app/navigation'
	import { page } from '$app/state'
	import { onMount } from 'svelte'
	import favicon from '$lib/assets/favicon.svg'
	import { Wordmark } from '$lib/shell'
	import { getSupabase } from '$lib/supabase'
	import { Button } from '$lib/ui'

	let { data, children } = $props()

	const inApp = $derived(
		page.url.pathname === '/app' || page.url.pathname.startsWith('/app/')
	)
	const onLogin = $derived(page.url.pathname.startsWith('/login'))

	onMount(() => {
		const supabase = getSupabase()
		const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
			const now = session?.user.id ?? null
			const was = data.session?.user.id ?? null
			if (now !== was) void invalidate('supabase:auth')
		})
		return () => listener.subscription.unsubscribe()
	})

	async function signOut() {
		await getSupabase().auth.signOut()
		await invalidate('supabase:auth')
		await goto('/')
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!-- Inside /app the app layout carries the navigation, so this bar stays out. -->
{#if !inApp}
	<header class="o-public-bar">
		<a class="o-public-brand" href="/">
			<Wordmark height="2rem" />
		</a>
		{#if data.session || !onLogin}
			<nav class="o-public-nav" aria-label="Product">
				{#if data.session}
					<a class="o-public-link" href="/app">Today</a>
					<Button variant="ghost" onclick={signOut}>Sign out</Button>
				{:else}
					<Button href="/login">Sign in</Button>
				{/if}
			</nav>
		{/if}
	</header>
{/if}

{@render children()}

<style>
	.o-public-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-2) var(--space-4);
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	.o-public-brand {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-target);
		border-radius: var(--radius-sm);
	}
	.o-public-nav {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.o-public-link {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap-target);
		padding: 0 var(--space-2);
		border-radius: var(--radius-sm);
		color: var(--text);
		font-size: var(--font-size-base);
		font-weight: var(--weight-medium);
		text-decoration: none;
	}
	.o-public-link:hover {
		background: color-mix(in srgb, var(--text) 6%, transparent);
	}

	@media (min-width: 900px) {
		.o-public-bar {
			padding: var(--space-3) var(--space-8);
		}
	}
</style>
