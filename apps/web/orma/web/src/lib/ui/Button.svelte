<script lang="ts">
	import type { Snippet } from 'svelte'

	/** The one action control. Primary, secondary, ghost or danger. */
	let {
		variant = 'primary',
		href,
		type = 'button',
		disabled = false,
		onclick,
		id,
		title,
		target,
		rel,
		ariaLabel,
		ariaExpanded,
		ariaControls,
		ariaPressed,
		class: className = '',
		children
	}: {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
		href?: string
		type?: 'button' | 'submit' | 'reset'
		disabled?: boolean
		onclick?: (event: MouseEvent) => void
		id?: string
		title?: string
		target?: string
		rel?: string
		ariaLabel?: string
		ariaExpanded?: boolean
		ariaControls?: string
		ariaPressed?: boolean
		class?: string
		children: Snippet
	} = $props()

	const classes = $derived(`o-btn o-btn-${variant}${className ? ` ${className}` : ''}`)
</script>

{#if href}
	<a
		{href}
		{id}
		{title}
		{target}
		{rel}
		{onclick}
		class={classes}
		aria-label={ariaLabel}
		aria-expanded={ariaExpanded}
		aria-controls={ariaControls}
		aria-disabled={disabled ? 'true' : undefined}
	>
		{@render children()}
	</a>
{:else}
	<button
		{type}
		{disabled}
		{id}
		{title}
		{onclick}
		class={classes}
		aria-label={ariaLabel}
		aria-expanded={ariaExpanded}
		aria-controls={ariaControls}
		aria-pressed={ariaPressed}
	>
		{@render children()}
	</button>
{/if}

<style>
	.o-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: var(--tap-target);
		padding: 0 var(--space-4);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		font: inherit;
		font-size: var(--font-size-base);
		font-weight: var(--weight-semibold);
		line-height: var(--line-snug);
		text-align: center;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--motion-fast) ease-out,
			border-color var(--motion-fast) ease-out,
			color var(--motion-fast) ease-out;
	}

	.o-btn-primary {
		background: var(--brand);
		color: var(--brand-contrast);
	}
	.o-btn-primary:hover {
		background: color-mix(in srgb, var(--brand) 88%, var(--text));
	}
	.o-btn-primary:active {
		background: color-mix(in srgb, var(--brand) 78%, var(--text));
	}

	.o-btn-secondary {
		background: transparent;
		border-color: var(--border-strong);
		color: var(--text);
	}
	.o-btn-secondary:hover {
		background: color-mix(in srgb, var(--text) 6%, transparent);
	}
	.o-btn-secondary:active {
		background: color-mix(in srgb, var(--text) 12%, transparent);
	}

	.o-btn-ghost {
		background: transparent;
		color: var(--brand);
		padding: 0 var(--space-2);
	}
	.o-btn-ghost:hover {
		background: color-mix(in srgb, var(--text) 6%, transparent);
	}

	.o-btn-danger {
		background: var(--danger);
		color: var(--danger-contrast);
	}
	.o-btn-danger:hover {
		background: color-mix(in srgb, var(--danger) 88%, var(--text));
	}
	.o-btn-danger:active {
		background: color-mix(in srgb, var(--danger) 78%, var(--text));
	}

	.o-btn:disabled,
	.o-btn[aria-disabled='true'] {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.o-btn[aria-disabled='true'] {
		pointer-events: none;
	}
</style>
