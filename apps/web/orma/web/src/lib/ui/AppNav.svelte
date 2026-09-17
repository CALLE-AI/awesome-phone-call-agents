<script lang="ts">
	import { APP_NAV, isCurrentNav } from './nav'

	let { path }: { path: string } = $props()
</script>

<nav class="o-nav" aria-label="App">
	{#each APP_NAV as link (link.href)}
		{@const current = isCurrentNav(path, link.href)}
		<a href={link.href} class="o-nav-link" class:on={current} aria-current={current ? 'page' : undefined}>{link.label}</a>
	{/each}
</nav>

<style>
	.o-nav {
		display: flex;
		gap: var(--space-1);
		overflow-x: auto;
		white-space: nowrap;
		border-bottom: 1px solid var(--border);
		scrollbar-width: none;
	}
	.o-nav::-webkit-scrollbar {
		display: none;
	}
	.o-nav-link {
		display: flex;
		align-items: center;
		min-height: var(--tap-target);
		padding: 0 var(--space-3);
		color: var(--text-muted);
		font-size: var(--font-size-base);
		font-weight: var(--weight-medium);
		text-decoration: none;
		border-bottom: 2px solid transparent;
		transition:
			color var(--motion-fast) ease-out,
			background-color var(--motion-fast) ease-out;
	}
	.o-nav-link:hover {
		color: var(--text);
	}
	.o-nav-link.on {
		color: var(--brand);
		font-weight: var(--weight-semibold);
		border-bottom-color: var(--brand);
	}
	@media (min-width: 900px) {
		.o-nav {
			flex-direction: column;
			gap: var(--space-1);
			border-bottom: 0;
			overflow: visible;
		}
		.o-nav-link {
			border-bottom: 0;
			border-radius: var(--radius-md);
			padding: 0 var(--space-3);
		}
		.o-nav-link.on {
			background: var(--brand-soft);
		}
	}
</style>
