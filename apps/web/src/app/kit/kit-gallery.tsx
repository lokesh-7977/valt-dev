"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { InfoIcon, SparklesIcon, TriangleAlertIcon, ZapIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { JsonView } from "@/components/ai/json-view";
import { ProcessingScreen } from "@/components/ai/processing-screen";
import {
  ConfidenceMeter,
  FactList,
  KeyPoints,
  RecommendedActions,
  TagList,
} from "@/components/ai/result-blocks";
import { StreamingText } from "@/components/ai/streaming-text";
import { ListGroup } from "@/components/dashboard/list-group";
import { StatCard, StatGrid } from "@/components/dashboard/stat-card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { CardSkeleton, ListSkeleton } from "@/components/feedback/skeletons";
import { EmptyState, ErrorState, LoadingState } from "@/components/feedback/states";
import { AudioRecorder } from "@/components/inputs/audio-recorder";
import { FileDropzone } from "@/components/inputs/file-dropzone";
import { FilePreviewList } from "@/components/inputs/file-preview-list";
import { ImageUpload } from "@/components/inputs/image-upload";
import { Section } from "@/components/layout/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useGenerateStream } from "@/hooks/use-generate-stream";

export function KitGallery() {
  return (
    <div className="flex flex-col gap-16">
      <Section title="Typography">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <p className="text-display font-semibold">Display</p>
            <p className="text-title-1 font-semibold">Title 1</p>
            <p className="text-title-2 font-semibold">Title 2</p>
            <p className="text-title-3 font-semibold">Title 3</p>
            <p className="text-body">Body — the default reading size for content.</p>
            <p className="text-callout text-muted-foreground">
              Callout — secondary text and UI labels.
            </p>
            <p className="text-footnote text-muted-foreground">
              Footnote — metadata, hints, captions.
            </p>
          </CardContent>
        </Card>
      </Section>

      <Section title="Buttons & badges">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Button size="sm">Small</Button>
          <Button size="lg" className="rounded-full">
            <SparklesIcon data-icon="inline-start" /> Hero CTA
          </Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <StatusBadge status="ok">Healthy</StatusBadge>
          <StatusBadge status="warning">Degraded</StatusBadge>
          <StatusBadge status="error">Failed</StatusBadge>
          <StatusBadge status="pending">Queued</StatusBadge>
        </div>
      </Section>

      <Section title="Alerts & toasts">
        <div className="grid gap-3 md:grid-cols-2">
          <Alert>
            <InfoIcon />
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>Neutral information for the user.</AlertDescription>
          </Alert>
          <Alert variant="success">
            <ZapIcon />
            <AlertTitle>Saved</AlertTitle>
            <AlertDescription>Your changes are live.</AlertDescription>
          </Alert>
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Low confidence</AlertTitle>
            <AlertDescription>Double-check before acting on this.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Upload failed</AlertTitle>
            <AlertDescription>The file was too large.</AlertDescription>
          </Alert>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => toast.success("Analysis ready")}>
            Success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.error("Something went wrong", { description: "Try again." })}
          >
            Error toast
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.promise(new Promise((r) => setTimeout(r, 1500)), {
                loading: "Working…",
                success: "Done",
                error: "Failed",
              })
            }
          >
            Promise toast
          </Button>
        </div>
      </Section>

      <Section title="Cards, stats & lists">
        <StatGrid>
          <StatCard label="Analyses today" value="128" hint="+12% vs. yesterday" icon={ZapIcon} />
          <StatCard label="Avg. confidence" value="87%" hint="Last 7 days" />
          <StatCard label="Status" value={<StatusBadge status="ok">Operational</StatusBadge>} />
        </StatGrid>
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>Supporting description text.</CardDescription>
            </CardHeader>
            <CardContent>Cards hold one idea each. No header dividers.</CardContent>
          </Card>
          <ListGroup
            items={[
              {
                id: "1",
                icon: SparklesIcon,
                title: "Drill-in row",
                description: "With a chevron",
                href: "#",
              },
              { id: "2", icon: ZapIcon, title: "Action row", onClick: () => toast("Clicked") },
              { id: "3", title: "Static row", trailing: <Badge variant="secondary">Info</Badge> },
            ]}
          />
        </div>
      </Section>

      <Section title="Form (React Hook Form + Zod)">
        <ExampleForm />
      </Section>

      <Section title="Tabs & dialog">
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">First</TabsTrigger>
            <TabsTrigger value="two">Second</TabsTrigger>
          </TabsList>
          <TabsContent value="one" className="text-callout text-muted-foreground">
            First tab content.
          </TabsContent>
          <TabsContent value="two" className="text-callout text-muted-foreground">
            Second tab content.
          </TabsContent>
        </Tabs>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary" className="w-fit">
              Open dialog
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm action</DialogTitle>
              <DialogDescription>
                Dialogs trap focus and return it to the trigger.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button onClick={() => toast.success("Confirmed")}>Confirm</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Section>

      <Section title="Loading, empty & error states">
        <div className="grid gap-6 md:grid-cols-2">
          <CardSkeleton />
          <ListSkeleton rows={2} />
          <EmptyState
            title="No results yet"
            description="Run your first analysis to see it here."
            action={<Button size="sm">Start</Button>}
          />
          <ErrorState
            error={{
              title: "Busy right now",
              description: "Wait a few seconds and try again.",
              requestId: "9f1c2e7a",
            }}
            onRetry={() => toast("Retrying…")}
            className="rounded-xl bg-card shadow-card"
          />
        </div>
        <LoadingState label="Loading results…" />
      </Section>

      <Section title="Inputs">
        <InputsDemo />
      </Section>

      <Section title="AI: processing, results, streaming">
        <ProcessingScreen
          startedAt={Date.now()}
          hints={["Reading your input…", "Finding the key points…"]}
          steps={[
            { id: "u", label: "Uploading your files", detail: "2 of 2", state: "done" },
            { id: "a", label: "Analyzing with Gemini", state: "active" },
            { id: "f", label: "Preparing results", state: "pending" },
          ]}
          onCancel={() => toast("Cancelled")}
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col gap-6">
            <RecommendedActions
              actions={[
                "Issue a replacement jar today",
                "Reply to the customer within 1 hour",
                "Flag courier damage",
              ]}
            />
            <KeyPoints
              points={["Order arrived damaged", "Two unanswered emails", "Deadline: Saturday"]}
            />
          </div>
          <Card>
            <CardContent className="flex flex-col gap-5">
              <ConfidenceMeter value={0.82} />
              <FactList
                facts={[
                  { label: "Model", value: "gemini-3.8-flash" },
                  { label: "Inputs", value: "text, 1 image" },
                ]}
              />
              <TagList
                title="Mentioned"
                items={[
                  { label: "Order #88213", hint: "id" },
                  { label: "Saturday", hint: "date" },
                ]}
              />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>JsonView — any structured result</CardTitle>
          </CardHeader>
          <CardContent>
            <JsonView
              value={{
                risk_level: "medium",
                confidence: 0.74,
                flags: ["late delivery", "repeat contact"],
                customer: { name: "A. Rivera", tier: "gold" },
                actions: [{ step: "Refund shipping", owner: "Support" }],
              }}
            />
          </CardContent>
        </Card>
        <StreamDemo />
      </Section>
    </div>
  );
}

const exampleSchema = z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters."),
  email: z.email("Enter a valid email."),
  notes: z.string().max(500, "Keep it under 500 characters."),
});

function ExampleForm() {
  const form = useForm<z.infer<typeof exampleSchema>>({
    resolver: zodResolver(exampleSchema),
    defaultValues: { name: "", email: "", notes: "" },
  });
  const e = form.formState.errors;
  return (
    <Card className="max-w-[560px]">
      <CardContent>
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={form.handleSubmit((v) => toast.success(`Submitted for ${v.name}`))}
        >
          <Field data-invalid={!!e.name}>
            <FieldLabel htmlFor="kit-name">Name</FieldLabel>
            <Input id="kit-name" aria-invalid={!!e.name} {...form.register("name")} />
            <FieldError errors={[e.name]} />
          </Field>
          <Field data-invalid={!!e.email}>
            <FieldLabel htmlFor="kit-email">Email</FieldLabel>
            <Input
              id="kit-email"
              type="email"
              aria-invalid={!!e.email}
              {...form.register("email")}
            />
            <FieldError errors={[e.email]} />
          </Field>
          <Field data-invalid={!!e.notes}>
            <FieldLabel htmlFor="kit-notes">Notes</FieldLabel>
            <Textarea id="kit-notes" aria-invalid={!!e.notes} {...form.register("notes")} />
            <FieldDescription>Optional.</FieldDescription>
            <FieldError errors={[e.notes]} />
          </Field>
          <Button type="submit" className="self-end">
            Submit
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function InputsDemo() {
  const [files, setFiles] = useState<File[]>([]);
  const [images, setImages] = useState<File[]>([]);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-3">
        <FileDropzone onFiles={(f) => setFiles((p) => [...p, ...f])} hint="Any file type" />
        <FilePreviewList
          files={files}
          onRemove={(i) => setFiles((p) => p.filter((_, j) => j !== i))}
        />
      </div>
      <AudioRecorder onRecorded={(f) => setFiles((p) => [...p, f])} />
      <ImageUpload value={images} onChange={setImages} className="lg:col-span-2" />
    </div>
  );
}

function StreamDemo() {
  const stream = useGenerateStream();
  const busy = stream.status === "waiting" || stream.status === "streaming";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Streaming (live — needs the API + GEMINI_API_KEY)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button
            disabled={busy}
            onClick={() =>
              void stream.start({ prompt: "In 3 short sentences, explain what a hackathon is." })
            }
          >
            Generate
          </Button>
          {busy && (
            <Button variant="secondary" onClick={stream.stop}>
              Stop
            </Button>
          )}
        </div>
        {stream.status !== "idle" && <StreamingText text={stream.text} streaming={busy} />}
        {stream.error && (
          <p role="alert" className="text-callout text-destructive">
            {stream.error.title}: {stream.error.description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
