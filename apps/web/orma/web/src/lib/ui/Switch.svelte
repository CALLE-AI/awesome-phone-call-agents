<script lang="ts">
	/**
	 * A switch that reports its next value. The label sits inside the control,
	 * so the row is one target and the name is never lost to assistive tech.
	 */
	let {
		checked,
		label,
		disabled = false,
		id,
		onchange,
		class: className = ''
	}: {
		checked: boolean
		label: string
		disabled?: boolean
		id?: string
		onchange?: (checked: boolean) => void
		class?: string
	} = $props()

	const classes = $derived(`o-switch${className ? ` ${className}` : ''}`)
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	{id}
	{disabled}
	class={classes}
	onclick={() => onchange?.(!checked)}
>
	<span class="o-switch-track" aria-hidden="true">
		<span class="o-switch-thumb"></span>
	</span>
	<span class="o-switch-label">{label}</span>
</button>

<style>
	.o-switch {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--tap-target);
		padding: 0;
		background: transparent;
		border: 0;
		color: var(--text);
		font: inherit;
		font-size: var(--font-size-base);
		text-align: left;
		cursor: pointer;
	}

	.o-switch-track {
		display: inline-flex;
		flex: none;
		align-items: center;
		width: 46px;
		height: 28px;
		padding: 3px;
		background: var(--border-strong);
		border-radius: var(--radius-pill);
		transition: background-color var(--motion-fast) ease-out;
	}

	.o-switch-thumb {
		width: 22px;
		height: 22px;
		background: var(--surface-raised);
		border-radius: 50%;
		transition: transform var(--motion-fast) ease-out;
	}

	.o-switch[aria-checked='true'] .o-switch-track {
		background: var(--brand);
	}
	.o-switch[aria-checked='true'] .o-switch-thumb {
		transform: translateX(18px);
	}

	.o-switch:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
