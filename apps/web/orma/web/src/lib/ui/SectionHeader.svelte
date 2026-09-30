<script lang="ts">
	import type { Snippet } from 'svelte'

	/** A section title, an optional hint, and a row for the section actions. */
	let {
		title,
		hint,
		level = 2,
		class: className = '',
		children
	}: {
		title: string
		hint?: string
		level?: 2 | 3
		class?: string
		children?: Snippet
	} = $props()

	const classes = $derived(`o-section-header${className ? ` ${className}` : ''}`)
</script>

<div class={classes}>
	<div class="o-section-header-text">
		{#if level === 3}
			<h3 class="o-section-header-title">{title}</h3>
		{:else}
			<h2 class="o-section-header-title">{title}</h2>
		{/if}
		{#if hint}
			<p class="o-section-header-hint">{hint}</p>
		{/if}
	</div>
	{#if children}
		<div class="o-section-header-actions">{@render children()}</div>
	{/if}
</div>

<style>
	.o-section-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
		min-width: 0;
	}

	.o-section-header-text {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.o-section-header-title {
		color: var(--text);
		font-size: var(--font-size-lg);
		font-weight: var(--weight-semibold);
		line-height: var(--line-snug);
		letter-spacing: var(--tracking-tight);
	}

	.o-section-header-hint {
		color: var(--text-muted);
		font-size: var(--font-size-sm);
	}

	.o-section-header-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
</style>
