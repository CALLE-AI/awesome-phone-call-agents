<script lang="ts">
	/*
	 * The one place the wordmark is drawn. Both files are the operator's
	 * artwork, byte for byte, so nothing here filters or recolours them.
	 */
	import darkWordmark from '$lib/assets/orma-wordmark-dark.svg'
	import lightWordmark from '$lib/assets/orma-wordmark-light.svg'

	let { height = '1.75rem' }: { height?: string } = $props()
</script>

<!--
	Both images render and CSS picks one. The file sits in the markup twice
	because a [data-theme] subtree beats a media query, which a picture
	source cannot express. Exactly one image is displayed at any theme, so
	the hidden one leaves the layout and the accessibility tree with it.
-->
<span class="o-wordmark" style:--wordmark-height={height}>
	<img class="o-wordmark-light" src={lightWordmark} width="480" height="200" alt="Orma" />
	<img class="o-wordmark-dark" src={darkWordmark} width="480" height="200" alt="Orma" />
</span>

<style>
	.o-wordmark {
		display: inline-flex;
		align-items: center;
	}

	.o-wordmark-light,
	.o-wordmark-dark {
		display: block;
		height: var(--wordmark-height, 1.75rem);
		width: auto;
	}

	.o-wordmark-dark {
		display: none;
	}

	@media (prefers-color-scheme: dark) {
		.o-wordmark-light {
			display: none;
		}
		.o-wordmark-dark {
			display: block;
		}
	}

	:global([data-theme='light']) .o-wordmark-light {
		display: block;
	}
	:global([data-theme='light']) .o-wordmark-dark {
		display: none;
	}
	:global([data-theme='dark']) .o-wordmark-light {
		display: none;
	}
	:global([data-theme='dark']) .o-wordmark-dark {
		display: block;
	}
</style>
