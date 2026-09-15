<script lang="ts">
	/*
	 * The phone navigation. Six tabs, one icon and one label each, pinned to
	 * the bottom edge and clear of the safe area inset.
	 */
	import { APP_NAV, isCurrentNav } from '$lib/ui'
	import TabIcon from './TabIcon.svelte'

	let { path }: { path: string } = $props()
</script>

<nav class="o-tabbar" aria-label="App" style:--tab-count={APP_NAV.length}>
	{#each APP_NAV as link (link.href)}
		{@const current = isCurrentNav(path, link.href)}
		<a
			class="o-tab"
			class:on={current}
			href={link.href}
			aria-current={current ? 'page' : undefined}
		>
			<TabIcon href={link.href} />
			<span class="o-tab-label">{link.label}</span>
		</a>
	{/each}
</nav>

<style>
	.o-tabbar {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 5;
		display: grid;
		grid-template-columns: repeat(var(--tab-count, 6), minmax(0, 1fr));
		background: var(--surface);
		border-top: 1px solid var(--border);
		padding-bottom: env(safe-area-inset-bottom);
	}

	.o-tab {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		min-height: var(--tabbar-height, 3.5rem);
		padding: var(--space-1) 1px;
		color: var(--text-muted);
		font-size: var(--font-size-xs);
		font-weight: var(--weight-medium);
		line-height: var(--line-tight);
		text-decoration: none;
		white-space: nowrap;
		transition: color var(--motion-fast) ease-out;
	}
	.o-tab:hover {
		color: var(--text);
	}
	/*
	 * The current tab reads through colour, aria-current and the rule above
	 * its icon. The semibold weight it used to take overran a 320 pixel cell
	 * and clipped the Timeline label, so weight no longer carries the cue.
	 */
	.o-tab.on {
		color: var(--brand);
	}
	.o-tab.on::before {
		content: '';
		position: absolute;
		inset: 0 0 auto 0;
		height: 3px;
		background: var(--brand);
	}
	.o-tab-label {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* From the sidebar width the app nav carries the tabs instead. */
	@media (min-width: 900px) {
		.o-tabbar {
			display: none;
		}
	}
</style>
