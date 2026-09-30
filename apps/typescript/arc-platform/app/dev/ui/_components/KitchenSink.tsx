"use client"

import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Mark } from "@/components/ui/mark"
import { Badge } from "@/components/ui/badge"
import { Toaster } from "@/components/ui/sonner"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

/* ---------------------------------------------------------------------------
   Layout helpers. Local to this page - not primitives.
   The wrapper sets bg/text/font explicitly because the legacy dark `body`
   rule in globals.css is unlayered and still wins over @layer base. That rule
   is stripped when the shell is converted; until then /dev/ui owns its canvas.
--------------------------------------------------------------------------- */

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-6 border-t border-border pt-10">
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-h2 text-text">{title}</h2>
        {hint ? <p className="text-small text-text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <span className="type-label text-text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

const PALETTE = [
  { name: "bone", hex: "#FBFAF7", use: "page background", cls: "bg-bone" },
  { name: "paper", hex: "#FFFFFF", use: "cards, panels", cls: "bg-paper" },
  { name: "ink", hex: "#141118", use: "primary text, primary button", cls: "bg-ink" },
  { name: "graphite", hex: "#6C6676", use: "secondary text", cls: "bg-graphite" },
  { name: "hairline", hex: "#E8E4EF", use: "borders, rules", cls: "bg-hairline" },
  { name: "lilac", hex: "#DCD8FB", use: "field background", cls: "bg-lilac" },
  { name: "lilac-deep", hex: "#A79BF2", use: "chart fill, active", cls: "bg-lilac-deep" },
  { name: "blush", hex: "#FBC7E6", use: "field background", cls: "bg-blush" },
  { name: "blush-deep", hex: "#F08FCE", use: "chart fill, emphasis", cls: "bg-blush-deep" },
  { name: "butter", hex: "#FAEDA1", use: "marker, secondary button", cls: "bg-butter" },
  { name: "butter-deep", hex: "#F2D64F", use: "chart fill, warning", cls: "bg-butter-deep" },
]

const SEMANTIC = [
  { name: "bg", maps: "bone", cls: "bg-bg" },
  { name: "surface", maps: "paper", cls: "bg-surface" },
  { name: "text", maps: "ink", cls: "bg-text" },
  { name: "text-muted", maps: "graphite", cls: "bg-text-muted" },
  { name: "border", maps: "hairline", cls: "bg-border" },
  { name: "primary", maps: "ink", cls: "bg-primary" },
  { name: "primary-fg", maps: "paper", cls: "bg-primary-fg" },
  { name: "accent", maps: "butter", cls: "bg-accent" },
]

const STATIONS = [
  { sign: "FM100", freq: "100.0 FM", city: "Karachi", daypart: "Drive", rate: "PKR 18,500", spot: "0:30", status: "lilac" },
  { sign: "HOT FM", freq: "105.0 FM", city: "Lahore", daypart: "Breakfast", rate: "PKR 22,000", spot: "0:30", status: "butter" },
  { sign: "CITY FM", freq: "89.0 FM", city: "Islamabad", daypart: "Late", rate: "PKR 9,750", spot: "0:20", status: "blush" },
] as const

export function KitchenSink() {
  const [loading, setLoading] = useState(false)

  return (
    <div className="min-h-screen bg-bg font-sans text-body text-text">
      <Toaster />

      <div className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16 md:px-10">
        {/* ---------- header ---------- */}
        <header className="flex flex-col gap-3">
          <span className="type-label text-text-muted">Review gate - section 6, step 3</span>
          <h1 className="font-display text-display text-text">
            Every primitive, <Mark>every state</Mark>
          </h1>
          <p className="max-w-2xl text-body text-text-muted">
            Tokens, type scale and primitives on the Arc palette. The marker above is
            the single permitted use of <code className="type-data">&lt;Mark&gt;</code> on
            this screen.
          </p>
        </header>

        {/* ---------- palette ---------- */}
        <Section
          title="Palette"
          hint="Raw palette tokens. Components never reference these directly except for chart fills, status pills and the tuner strip."
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {PALETTE.map((c) => (
              <div key={c.name} className="flex flex-col gap-2">
                <div className={`${c.cls} h-16 w-full rounded-control border border-border`} />
                <div className="flex flex-col gap-0.5">
                  <span className="text-small font-medium text-text">--{c.name}</span>
                  <span className="type-data text-text-muted">{c.hex}</span>
                  <span className="text-small text-text-muted">{c.use}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Semantic aliases"
          hint="What components are actually allowed to use. Each one points at a palette token - dark mode changes these values and nothing else."
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {SEMANTIC.map((c) => (
              <div key={c.name} className="flex flex-col gap-2">
                <div className={`${c.cls} h-12 w-full rounded-control border border-border`} />
                <span className="text-small font-medium text-text">--{c.name}</span>
                <span className="type-data text-text-muted">→ {c.maps}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------- type scale ---------- */}
        <Section title="Type scale" hint="Gabarito for display, Inter for body, JetBrains Mono for data.">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
              <span className="type-label text-text-muted">display · Gabarito 800</span>
              <p className="font-display text-display text-text">Call the shortlist</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="type-label text-text-muted">h1 · Gabarito 700</span>
              <p className="font-display text-h1 text-text">Call the shortlist</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="type-label text-text-muted">h2 · Gabarito 700</span>
              <p className="font-display text-h2 text-text">Call the shortlist</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="type-label text-text-muted">h3 · Gabarito 600</span>
              <p className="font-display text-h3 text-text">Call the shortlist</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="type-label text-text-muted">body · Inter 400</span>
              <p className="text-body text-text">
                Nine stations shortlisted across Karachi and Lahore. Drive-time
                airtime is the tightest inventory this week.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="type-label text-text-muted">small · Inter 400</span>
              <p className="text-small text-text-muted">
                Rates shown exclude agency commission.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="type-label text-text-muted">label · Inter 500 uppercase</span>
              <p className="type-label text-text-muted">Daypart</p>
            </div>
            <div className="flex flex-col gap-1">
              <span className="type-label text-text-muted">
                data · JetBrains Mono 500 tabular
              </span>
              <p className="type-data text-text">101.6 FM · 0:30 · PKR 18,500 · 14:22</p>
            </div>
          </div>
        </Section>

        {/* ---------- buttons ---------- */}
        <Section
          title="Button"
          hint="Primary is near-black with white text - the pastels are fields, the black is the action. Tab through these: every one takes a visible focus ring."
        >
          <Row label="Primary">
            <Button>Call the shortlist</Button>
            <Button className="hover:bg-primary/85">Hover</Button>
            <Button loading>Calling</Button>
            <Button disabled>Disabled</Button>
          </Row>
          <Row label="Secondary">
            <Button variant="secondary">Save draft</Button>
            <Button variant="secondary" loading>Saving</Button>
            <Button variant="secondary" disabled>Disabled</Button>
          </Row>
          <Row label="Ghost">
            <Button variant="ghost">Back to stations</Button>
            <Button variant="ghost" loading>Loading</Button>
            <Button variant="ghost" disabled>Disabled</Button>
          </Row>
          <Row label="Destructive / outline / link">
            <Button variant="destructive">Cancel campaign</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="link">Link</Button>
          </Row>
          <Row label="Sizes">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
          </Row>
        </Section>

        {/* ---------- inputs ---------- */}
        <Section title="Input, Label & Select" hint="Error states are driven by aria-invalid, so the styling and the screen-reader signal cannot drift apart.">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="k-default">Station name</Label>
              <Input id="k-default" placeholder="Search stations" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="k-filled">Filled</Label>
              <Input id="k-filled" defaultValue="FM100 Karachi" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="k-disabled">Disabled</Label>
              <Input id="k-disabled" placeholder="Not editable" disabled />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="k-error">Number to call</Label>
              <Input
                id="k-error"
                defaultValue="0300 1234567"
                aria-invalid
                aria-describedby="k-error-msg"
              />
              <p id="k-error-msg" className="text-small text-danger">
                Couldn&apos;t reach that number. Check the country code and try again.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="k-select">Daypart</Label>
              <Select>
                <SelectTrigger id="k-select" className="w-full">
                  <SelectValue placeholder="Choose a daypart" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="breakfast">Breakfast · 07:00-10:00</SelectItem>
                  <SelectItem value="midday">Midday · 10:00-16:00</SelectItem>
                  <SelectItem value="drive">Drive · 16:00-20:00</SelectItem>
                  <SelectItem value="late">Late · 20:00-00:00</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="k-select-d">Disabled select</Label>
              <Select disabled>
                <SelectTrigger id="k-select-d" className="w-full">
                  <SelectValue placeholder="Unavailable" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="x">x</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        {/* ---------- textarea ---------- */}
        <Section
          title="Textarea"
          hint="The Input primitive's twin - same radius, border and focus ring, so multi-line text never drifts into its own style."
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="k-ta">Audience description</Label>
              <Textarea id="k-ta" placeholder="Who is this campaign for?" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="k-ta-filled">Filled</Label>
              <Textarea
                id="k-ta-filled"
                defaultValue="Working women aged 25-40 in Karachi who cook at home and value quality ingredients."
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="k-ta-disabled">Disabled</Label>
              <Textarea id="k-ta-disabled" placeholder="Not editable" disabled />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="k-ta-error">Script hook</Label>
              <Textarea
                id="k-ta-error"
                defaultValue="Ye Ramzan, har dastarkhwan pe..."
                aria-invalid
                aria-describedby="k-ta-error-msg"
              />
              <p id="k-ta-error-msg" className="text-small text-danger">
                A hook has to fit in five seconds. Trim it to about 12 words.
              </p>
            </div>
          </div>
        </Section>

        {/* ---------- badges ---------- */}
        <Section
          title="Badge / Pill"
          hint="Status pills are one of the three places pastel is allowed inside the app."
        >
          <Row label="Variants">
            <Badge>Live</Badge>
            <Badge variant="lilac">Shortlisted</Badge>
            <Badge variant="blush">Awaiting rate</Badge>
            <Badge variant="butter">Negotiating</Badge>
            <Badge variant="outline">Draft</Badge>
            <Badge variant="muted">Archived</Badge>
            <Badge variant="destructive">Unreachable</Badge>
          </Row>
        </Section>

        {/* ---------- cards ---------- */}
        <Section title="Card" hint="24px radius, one shadow, no border. Pastel stays under ~15% inside the app.">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>FM100 Karachi</CardTitle>
                <CardDescription>Drive time · 16:00-20:00</CardDescription>
                <CardAction>
                  <Badge variant="lilac">Shortlisted</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="type-data text-text">100.0 FM · 0:30 spot</p>
                <p className="text-small text-text-muted">
                  Rate card confirmed by the station.
                </p>
              </CardContent>
              <CardFooter className="justify-between">
                <span className="type-data text-text">PKR 18,500</span>
                <Button size="sm">Call station</Button>
              </CardFooter>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>No stations shortlisted yet</CardTitle>
                <CardDescription>Add one to start calling.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-small text-text-muted">
                  Empty states are an invitation, not an apology - section 7.
                </p>
              </CardContent>
              <CardFooter>
                <Button variant="secondary" size="sm">Browse stations</Button>
              </CardFooter>
            </Card>
          </div>
        </Section>

        {/* ---------- table ---------- */}
        <Section title="Table" hint="Frequencies, rates and durations are mono and tabular - alignment is functionally correct here, not decorative.">
          <Card className="p-0">
            <CardContent className="px-0">
              <Table>
                <TableCaption>Shortlist · 3 stations</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Station</TableHead>
                    <TableHead>Frequency</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Daypart</TableHead>
                    <TableHead className="text-right">Spot</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {STATIONS.map((s) => (
                    <TableRow key={s.sign}>
                      <TableCell className="font-medium">{s.sign}</TableCell>
                      <TableCell className="type-data">{s.freq}</TableCell>
                      <TableCell>{s.city}</TableCell>
                      <TableCell>{s.daypart}</TableCell>
                      <TableCell className="type-data text-right">{s.spot}</TableCell>
                      <TableCell className="type-data text-right">{s.rate}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant={s.status}>{s.daypart}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Section>

        {/* ---------- tabs ---------- */}
        <Section title="Tabs" hint="Real roving-focus keyboard handling from Radix - arrow keys move between tabs.">
          <Tabs defaultValue="stations">
            <TabsList>
              <TabsTrigger value="stations">Stations</TabsTrigger>
              <TabsTrigger value="creators">Creators</TabsTrigger>
              <TabsTrigger value="airtime">Airtime</TabsTrigger>
              <TabsTrigger value="locked" disabled>Locked</TabsTrigger>
            </TabsList>
            <TabsContent value="stations">
              <p className="text-body text-text-muted">Nine stations across two cities.</p>
            </TabsContent>
            <TabsContent value="creators">
              <p className="text-body text-text-muted">Four creators awaiting a rate card.</p>
            </TabsContent>
            <TabsContent value="airtime">
              <p className="text-body text-text-muted">
                The tuner strip lands here in stage 5.
              </p>
            </TabsContent>
          </Tabs>
        </Section>

        {/* ---------- dialog + toast ---------- */}
        <Section title="Dialog & Toast" hint="Dialog traps focus and restores it on close; Escape and overlay click both dismiss. Toast keeps the button's verb.">
          <Row label="Triggers">
            <Dialog>
              <DialogTrigger asChild>
                <Button>Call the shortlist</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Call three stations?</DialogTitle>
                  <DialogDescription>
                    Arc will call FM100, HOT FM and CITY FM in order and ask each for
                    drive-time availability.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">Not yet</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button
                      onClick={() =>
                        toast.success("Calling", {
                          description: "FM100 Karachi · dialling now",
                        })
                      }
                    >
                      Call the shortlist
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button
              variant="secondary"
              loading={loading}
              onClick={() => {
                setLoading(true)
                toast.success("Calling", { description: "HOT FM Lahore · dialling now" })
                setTimeout(() => setLoading(false), 2200)
              }}
            >
              {loading ? "Calling" : "Call one station"}
            </Button>

            <Button
              variant="ghost"
              onClick={() =>
                toast.error("Couldn't reach that number", {
                  description: "Check the country code and try again.",
                })
              }
            >
              Show an error toast
            </Button>
          </Row>
        </Section>

        <footer className="border-t border-border pt-8 pb-4">
          <p className="text-small text-text-muted">
            /dev/ui is dev-only - it 404s in a production build (section 6).
          </p>
        </footer>
      </div>
    </div>
  )
}
