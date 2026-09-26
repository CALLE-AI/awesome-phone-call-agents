<script lang="ts">
	import type { Snippet } from 'svelte'

	/** A surface. Raised lifts it on a shadow, tone tints it, padded gutters it. */
	let {
		raised = false,
		tone = 'default',
		padded = true,
		class: className = '',
		children
	}: {
		raised?: boolean
		tone?: 'default' | 'brand' | 'danger'
		padded?: boolean
		class?: string
		children: Snippet
	} = $props()

	const classes = $derived(
		['o-card', `o-card-${tone}`, raised && 'o-card-raised', padded && 'o-card-padded', className]
			.filter(Boolean)
			.join(' ')
	)
</script>

<div class={classes}>{@render children()}</div>

<style>
	.o-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}

	.o-card-padded {
		padding: var(--space-4);
	}
	@media (min-width: 600px) {
		.o-card-padded {
			padding: var(--space-6);
		}
	}

	.o-card-raised {
		background: var(--surface-raised);
		box-shadow: var(--elevation-2);
	}

	.o-card-brand {
		background: var(--brand-soft);
		border-color: color-mix(in srgb, var(--brand) 70%, transparent);
	}

	.o-card-danger {
		background: var(--danger-soft);
		border-color: color-mix(in srgb, var(--danger) 70%, transparent);
	}
</style>
