<script lang="ts">
	import type { Snippet } from 'svelte'

	/** A calm, centred placeholder. Any snippet becomes the row of actions. */
	let {
		title,
		body,
		class: className = '',
		children
	}: {
		title: string
		body?: string
		class?: string
		children?: Snippet
	} = $props()

	const classes = $derived(`o-empty${className ? ` ${className}` : ''}`)
</script>

<div class={classes}>
	<p class="o-empty-title">{title}</p>
	{#if body}
		<p class="o-empty-body">{body}</p>
	{/if}
	{#if children}
		<div class="o-empty-actions">{@render children()}</div>
	{/if}
</div>

<style>
	.o-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-8) var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		text-align: center;
	}

	.o-empty-title {
		color: var(--text);
		font-size: var(--font-size-lg);
		font-weight: var(--weight-semibold);
		line-height: var(--line-snug);
	}

	.o-empty-body {
		max-width: 32rem;
		color: var(--text-muted);
		font-size: var(--font-size-base);
		text-wrap: pretty;
	}

	.o-empty-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}
</style>
