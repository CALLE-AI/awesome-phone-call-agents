<script lang="ts">
	import { Button } from '$lib/ui'
</script>
<svelte:head>
	<title>Orma · it remembers what you keep not doing</title>
	<meta name="description" content="A daily two-minute accountability call. It rings at a time you chose, leads with what you keep not doing, asks what needs capturing, and hangs up." />
	<meta property="og:title" content="Orma" />
	<meta property="og:description" content="It remembers what you keep not doing." />
	<meta property="og:type" content="website" />
</svelte:head>

<main>
	<section class="hero">
		<div class="hero-copy">
			<p class="kicker">A daily two-minute call</p>
			<h1>It remembers what you keep not&nbsp;doing.</h1>
			<p class="lede">
				Orma rings at a time you chose, leads with what you keep <em>not</em> doing, asks what
				needs capturing, and hangs up.
			</p>
			<div class="hero-actions">
				<Button href="/login">Sign in</Button>
				<Button href="#how" variant="secondary">How it works</Button>
			</div>
		</div>

		<!-- Product visual: the phone frame, drawn on tokens. -->
		<div class="hero-visual" aria-hidden="true">
			<div class="phone">
				<div class="phone-card">
					<p class="phone-label">Next call · Tomorrow, 08:00</p>
					<div class="chat">
						<p class="line"><span class="who">Orma</span>You've mentioned the dentist three times. It's been 34 days.</p>
						<p class="line you"><span class="who">You</span>Kill it.</p>
						<p class="line"><span class="who">Orma</span>Done. It's gone.</p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<section class="how" id="how">
		<h2>How it works</h2>
		<div class="steps">
			<div class="step">
				<span class="step-no">1</span>
				<h3>Set a time</h3>
				<p>Pick a daily slot. It rings from a number you won't recognise. Answer it anyway.</p>
			</div>
			<div class="step">
				<span class="step-no">2</span>
				<h3>Answer the call</h3>
				<p>It leads with what you keep not doing, then asks what needs capturing.</p>
			</div>
			<div class="step">
				<span class="step-no">3</span>
				<h3>The list stays honest</h3>
				<p>Being allowed to drop something honestly keeps the rest of the list truthful.</p>
			</div>
		</div>
	</section>

	<section class="surfaces">
		<h2>One call, three ways in</h2>
		<div class="cards">
			<div class="card">
				<h3>Phone call</h3>
				<p>The only channel that asks. Everything else is a receipt.</p>
			</div>
			<div class="card">
				<h3>Telegram</h3>
				<p>Capture a thought the moment you have it. The summary comes back after the call.</p>
			</div>
			<div class="card">
				<h3>MCP</h3>
				<p>Add items, set the slot, read the last call. From your agent, no browser.</p>
			</div>
		</div>
	</section>

	<section class="trust">
		<h2>The fine print, up front</h2>
		<div class="cards">
			<div class="card">
				<h3>Consent first</h3>
				<p>The wording you agree to is stored, versioned, and withdrawable any time.</p>
			</div>
			<div class="card">
				<h3>Cancel any time</h3>
				<p>Cancel today's call, pause all calls, delete the account. One tap each.</p>
			</div>
			<div class="card">
				<h3>Dry run by default</h3>
				<p>The engine is verified against recorded calls before anything rings.</p>
			</div>
		</div>
	</section>

	<section class="cta">
		<h2>Set your first call</h2>
		<p class="lede">Sign up or sign in. Your first slot takes a minute.</p>
		<Button href="/login">Sign in</Button>
	</section>
</main>

<style>
	main {
		width: 100%;
	}

	/* Shared rhythm. */
	.kicker,
	h2 {
		color: var(--brand);
		font-size: var(--font-size-sm);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
	}
	h2 {
		margin: 0 0 var(--space-6);
	}
	.lede {
		color: var(--text-muted);
		font-size: var(--font-size-lg);
		line-height: var(--line-normal);
	}

	/* Hero. */
	.hero {
		display: flex;
		flex-direction: column;
		gap: var(--space-10);
		max-width: 66rem;
		margin: 0 auto;
		padding: var(--space-10) var(--space-5) 0;
	}
	.hero-copy {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-4);
		max-width: 34rem;
	}
	h1 {
		margin: 0;
		color: var(--text);
		font-size: var(--font-size-3xl);
		font-weight: var(--weight-bold);
		line-height: var(--line-tight);
		letter-spacing: var(--tracking-tight);
	}
	.hero-actions {
		display: flex;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}

	/* The phone frame is decorative and carries no interaction. */
	.hero-visual {
		display: flex;
		justify-content: center;
	}
	.phone {
		width: min(20rem, 100%);
		padding: var(--space-3);
		background: var(--canvas);
		border: 1px solid var(--border);
		border-radius: var(--radius-xl);
		box-shadow: var(--elevation-3);
	}
	.phone-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-5);
		background: var(--surface-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.phone-label {
		color: var(--text-muted);
		font-size: var(--font-size-xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
	}
	.chat {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.line {
		padding: var(--space-2) var(--space-3);
		background: var(--brand-soft);
		border-radius: var(--radius-md);
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
	}
	.line.you {
		align-self: flex-end;
		background: color-mix(in srgb, var(--text) 6%, transparent);
	}
	.who {
		display: block;
		margin-bottom: var(--space-1);
		color: var(--text-muted);
		font-size: var(--font-size-xs);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-wide);
		text-transform: uppercase;
	}

	/* Sections. */
	.how,
	.surfaces,
	.trust,
	.cta {
		max-width: 66rem;
		margin: 0 auto;
		padding: var(--space-16) var(--space-5) 0;
	}

	.steps {
		display: grid;
		gap: var(--space-4);
	}
	@media (min-width: 900px) {
		.steps {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	.step {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-5);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}
	.step h3,
	.card h3 {
		margin: 0;
		color: var(--text);
		font-size: var(--font-size-lg);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
	}
	.step p,
	.card p {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--font-size-sm);
		line-height: var(--line-snug);
	}
	.step-no {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		background: var(--brand);
		color: var(--brand-contrast);
		border-radius: var(--radius-pill);
		font-size: var(--font-size-sm);
		font-weight: var(--weight-semibold);
	}

	.cards {
		display: grid;
		gap: var(--space-4);
	}
	@media (min-width: 900px) {
		.cards {
			grid-template-columns: repeat(3, 1fr);
		}
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-5);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
	}

	/* Closing action. */
	.cta {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-4);
		padding-bottom: var(--space-16);
		text-align: center;
	}
	.cta .lede {
		max-width: 30rem;
	}
	@media (min-width: 900px) {
		.hero {
			flex-direction: row;
			align-items: center;
			gap: var(--space-16);
		}
		.hero-copy {
			flex: 1;
		}
		.hero-visual {
			flex: 1;
		}
	}
</style>
