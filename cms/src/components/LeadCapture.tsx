import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { useForm } from "react-hook-form";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import * as z from "zod/mini";
import type { LeadCaptureContent } from "../i18n/home";
import type { Lang } from "../i18n/ui";

/**
 * Contact section, a React island (client:visible). Ported from
 * client/src/components/sections/LeadCapture.tsx: heading, booking card, form/quiz
 * tabs, the same POST /api/contact payload. All copy comes in through `content`.
 *
 * Before hydration the form is a plain POST to /api/contact (so no field values can
 * end up in the URL) and the submit button is disabled. Bundle: react-hook-form,
 * zod/mini and the resolver are the only libraries; keep it that way (80 KB budget).
 */

export interface LeadCaptureProps {
	lang: Lang;
	content: LeadCaptureContent;
}

type Tab = "form" | "quiz";
type Recommendation = "book_call" | "audit" | "quote";

const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
// Text size is set per button, so that a size class never has to fight the base.
const BUTTON_BASE = `inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${FOCUS_RING}`;
const BUTTON_PRIMARY = `${BUTTON_BASE} rounded-md border border-primary bg-primary text-primary-foreground hover:bg-primary/90`;
const BUTTON_OUTLINE = `${BUTTON_BASE} rounded-md border border-input bg-transparent shadow-xs hover:border-primary hover:bg-secondary/50`;
const INPUT_CLASS = `flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground md:text-sm aria-invalid:border-red-600 dark:aria-invalid:border-red-400 ${FOCUS_RING}`;
const LABEL_CLASS = "block text-sm leading-none font-medium";
const ERROR_CLASS = "text-[0.8rem] font-medium text-red-600 dark:text-red-400";
const HEADING_CLASS = "font-serif text-2xl focus:outline-none";
/* Entry transition on mount (CSS @starting-style); reduced motion turns it off. */
const ENTER_CLASS = "transition-[opacity,translate,scale] duration-300 ease-out motion-reduce:transition-none";

/**
 * Client rules = server limits (server/contact.ts). Values are trimmed before they are
 * checked and sent. zod/mini keeps the bundle small.
 */
function buildSchema(messages: LeadCaptureContent["form"]["validation"]) {
	return z.object({
		name: z.string().check(z.trim(), z.minLength(2, messages.nameMin), z.maxLength(200, messages.nameMax)),
		email: z.pipe(
			z.string().check(z.trim(), z.maxLength(254, messages.emailMax)),
			z.email(messages.emailInvalid),
		),
		company: z
			.string()
			.check(z.trim(), z.minLength(2, messages.companyMin), z.maxLength(200, messages.companyMax)),
		message: z.string().check(z.trim(), z.minLength(10, messages.messageMin), z.maxLength(5000, messages.messageMax)),
		budget: z.string(),
	});
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;
type FieldName = keyof FormValues;

const EMPTY_VALUES: FormValues = { name: "", email: "", company: "", message: "", budget: "" };

/** The quiz rules as before: timeline 3 or no budget gives an audit, now and 5000+ a call. */
function recommend(answers: number[]): Recommendation {
	const timeline = answers[1];
	const budget = answers[2];
	if (timeline === 3 || budget === 0) return "audit";
	if (timeline === 0 && budget > 1) return "book_call";
	return "quote";
}

export function LeadCapture({ lang, content }: LeadCaptureProps) {
	const [tab, setTab] = useState<Tab>("form");
	const [focusNameOnMount, setFocusNameOnMount] = useState(false);
	const panelId = useId();

	const selectTab = (next: Tab) => {
		setFocusNameOnMount(false);
		setTab(next);
	};

	// Quiz result "audit" or "quote": switch to the form and put the cursor in the first field.
	const openForm = () => {
		setFocusNameOnMount(true);
		setTab("form");
	};

	return (
		<div lang={lang} className="grid grid-cols-1 gap-12 text-left lg:grid-cols-2 lg:gap-24">
			<div className="space-y-8">
				<div>
					<h2 className="mb-6 font-serif text-4xl md:text-5xl">{content.title}</h2>
					<p className="text-xl font-light text-muted-foreground">{content.subtitle}</p>
				</div>

				<div className="flex gap-4">
					<TabButton pressed={tab === "form"} controls={panelId} onClick={() => selectTab("form")}>
						{content.tabs.form}
					</TabButton>
					<TabButton pressed={tab === "quiz"} controls={panelId} onClick={() => selectTab("quiz")}>
						{content.tabs.quiz}
					</TabButton>
				</div>

				<div className="hidden rounded-2xl border border-border/50 bg-secondary/30 p-6 lg:mt-12 lg:block">
					<div className="mb-4 flex items-center gap-4">
						<div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
							<CalendarIcon className="h-5 w-5 text-primary" />
						</div>
						<div>
							<h3 className="font-medium">{content.booking.title}</h3>
							<p className="text-sm text-muted-foreground">{content.booking.subtitle}</p>
						</div>
					</div>
					<a
						href={content.booking.url}
						target="_blank"
						rel="noopener noreferrer"
						className={`rounded-sm text-sm font-medium text-primary underline underline-offset-4 ${FOCUS_RING}`}
					>
						{content.booking.cta} &rarr;
					</a>
				</div>
			</div>

			<div
				id={panelId}
				role="group"
				aria-label={content.title}
				className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-primary/5 md:p-8"
			>
				{tab === "form" ? (
					<ContactForm content={content.form} autoFocusName={focusNameOnMount} />
				) : (
					<Quiz content={content.quiz} bookingUrl={content.booking.url} onRequestForm={openForm} />
				)}
			</div>
		</div>
	);
}

function TabButton({
	pressed,
	controls,
	onClick,
	children,
}: {
	pressed: boolean;
	controls: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			aria-controls={controls}
			onClick={onClick}
			className={`inline-flex min-h-9 items-center justify-center rounded-full border px-4 py-2 text-sm font-medium transition-colors ${FOCUS_RING} ${
				pressed
					? "border-primary bg-primary text-primary-foreground"
					: "border-input bg-transparent shadow-xs hover:bg-secondary/50"
			}`}
		>
			{children}
		</button>
	);
}

/**
 * The text to show for a failed request. Mapped by status, so the server's own
 * (English) text is only used for statuses that have no entry here.
 */
async function errorText(response: Response, form: LeadCaptureContent["form"]): Promise<string> {
	let data: unknown;
	try {
		data = await response.json();
	} catch {
		return form.networkError;
	}
	switch (response.status) {
		case 400:
		case 422:
			return form.serverErrors.invalid;
		case 429:
			return form.serverErrors.tooMany;
		case 500:
			return form.serverErrors.failed;
		case 502:
		case 503:
		case 504:
			return form.networkError;
	}
	const message = data && typeof data === "object" && "message" in data ? data.message : undefined;
	return typeof message === "string" && message.trim() ? message : form.networkError;
}

function Field({
	id,
	label,
	error,
	children,
}: {
	id: string;
	label: string;
	error?: string;
	children: ReactNode;
}) {
	return (
		<div className="space-y-2">
			<label htmlFor={id} className={LABEL_CLASS}>
				{label}
			</label>
			{children}
			{error ? (
				<p id={`${id}-error`} className={ERROR_CLASS}>
					{error}
				</p>
			) : null}
		</div>
	);
}

function ContactForm({
	content,
	autoFocusName,
}: {
	content: LeadCaptureContent["form"];
	autoFocusName: boolean;
}) {
	const base = useId();
	const id = (name: FieldName) => `${base}-${name}`;
	const schema = useMemo(() => buildSchema(content.validation), [content.validation]);
	const [ready, setReady] = useState(false);
	const [sending, setSending] = useState(false);
	const [sent, setSent] = useState(false);
	// The object identity changes on every failure, so the same message is announced again.
	const [serverError, setServerError] = useState<{ text: string } | null>(null);
	const successRef = useRef<HTMLHeadingElement>(null);
	const alertRef = useRef<HTMLParagraphElement>(null);
	const nameRef = useRef<HTMLInputElement | null>(null);
	const submittingRef = useRef(false);
	// Where focus goes after the next render: the success text, or the first field again.
	const focusAfterRender = useRef<"success" | "name" | null>(null);

	const {
		register,
		handleSubmit,
		reset,
		watch,
		formState: { errors },
	} = useForm<FormValues>({
		resolver: standardSchemaResolver(schema),
		defaultValues: EMPTY_VALUES,
	});

	const nameField = register("name");
	const budget = watch("budget");

	useEffect(() => {
		setReady(true);
	}, []);

	useEffect(() => {
		if (autoFocusName) nameRef.current?.focus();
	}, [autoFocusName]);

	useEffect(() => {
		if (focusAfterRender.current === "success") successRef.current?.focus();
		if (focusAfterRender.current === "name") nameRef.current?.focus();
		focusAfterRender.current = null;
	}, [sent]);

	// The submit button is disabled while sending, so focus would drop to <body>. Move it here.
	useEffect(() => {
		if (serverError) alertRef.current?.focus();
	}, [serverError]);

	async function onSubmit(values: FormValues) {
		if (submittingRef.current) return;
		submittingRef.current = true;
		setSending(true);
		setServerError(null);
		try {
			const response = await fetch("/api/contact", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: values.name,
					email: values.email,
					company: values.company,
					message: values.message,
					budget: values.budget,
				}),
			});
			if (!response.ok) {
				setServerError({ text: await errorText(response, content) });
				return;
			}
			reset(EMPTY_VALUES);
			focusAfterRender.current = "success";
			setSent(true);
		} catch {
			setServerError({ text: content.networkError });
		} finally {
			submittingRef.current = false;
			setSending(false);
		}
	}

	if (sent) {
		return (
			<div
				className={`${ENTER_CLASS} flex min-h-[400px] flex-col items-center justify-center space-y-4 text-center starting:scale-95 starting:opacity-0`}
			>
				<div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
					<CheckIcon className="h-10 w-10" />
				</div>
				<h3 ref={successRef} tabIndex={-1} className={HEADING_CLASS}>
					{content.success}
				</h3>
				<button
					type="button"
					onClick={() => {
						focusAfterRender.current = "name";
						setSent(false);
					}}
					className={`${BUTTON_OUTLINE} h-9 px-4 text-sm`}
				>
					{content.sendAnother}
				</button>
			</div>
		);
	}

	const invalid = (name: FieldName) => (errors[name] ? true : undefined);
	const describedBy = (name: FieldName) => (errors[name] ? `${id(name)}-error` : undefined);
	const message = (name: FieldName) => errors[name]?.message;

	// Before hydration the browser posts the form natively; no JS ever sends field values in the URL.
	const onFormSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
		if (!ready) {
			event.preventDefault();
			return;
		}
		void handleSubmit(onSubmit)(event);
	};

	return (
		<div className={`${ENTER_CLASS} starting:translate-x-5 starting:opacity-0`}>
			<form
				noValidate
				method="post"
				action="/api/contact"
				onSubmit={onFormSubmit}
				className="space-y-6"
			>
				<Field id={id("name")} label={content.name} error={message("name")}>
					<input
						id={id("name")}
						type="text"
						autoComplete="name"
						placeholder={content.placeholders.name}
						className={INPUT_CLASS}
						aria-invalid={invalid("name")}
						aria-describedby={describedBy("name")}
						{...nameField}
						ref={(element) => {
							nameField.ref(element);
							nameRef.current = element;
						}}
					/>
				</Field>

				<div className="grid grid-cols-1 gap-6 md:grid-cols-2">
					<Field id={id("email")} label={content.email} error={message("email")}>
						<input
							id={id("email")}
							type="email"
							autoComplete="email"
							placeholder={content.placeholders.email}
							className={INPUT_CLASS}
							aria-invalid={invalid("email")}
							aria-describedby={describedBy("email")}
							{...register("email")}
						/>
					</Field>
					<Field id={id("company")} label={content.company} error={message("company")}>
						<input
							id={id("company")}
							type="text"
							autoComplete="organization"
							placeholder={content.placeholders.company}
							className={INPUT_CLASS}
							aria-invalid={invalid("company")}
							aria-describedby={describedBy("company")}
							{...register("company")}
						/>
					</Field>
				</div>

				<Field id={id("budget")} label={content.budget}>
					<div className="relative">
						<select
							id={id("budget")}
							className={`flex h-9 w-full appearance-none rounded-md border border-input bg-transparent py-1 pr-9 pl-3 text-sm shadow-sm dark:[color-scheme:dark] ${budget ? "" : "text-muted-foreground"} ${FOCUS_RING}`}
							{...register("budget")}
						>
							<option value="">{content.placeholders.budget}</option>
							{content.budgetOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
						<ChevronDownIcon className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 opacity-50" />
					</div>
				</Field>

				<Field id={id("message")} label={content.message} error={message("message")}>
					<textarea
						id={id("message")}
						className={`${INPUT_CLASS} min-h-[120px] py-2`}
						placeholder={content.placeholders.message}
						aria-invalid={invalid("message")}
						aria-describedby={describedBy("message")}
						{...register("message")}
					/>
				</Field>

				{serverError ? (
					<p
						ref={alertRef}
						role="alert"
						tabIndex={-1}
						className="rounded-md border border-red-600/40 bg-red-600/5 px-4 py-3 text-sm text-red-700 focus:outline-none dark:border-red-400/40 dark:bg-red-400/5 dark:text-red-300"
					>
						{serverError.text}
					</p>
				) : null}

				<button
					type="submit"
					disabled={!ready || sending}
					className={`${BUTTON_PRIMARY} h-12 w-full text-lg`}
				>
					{sending ? (
						<>
							<SpinnerIcon className="h-4 w-4 animate-spin" />
							<span>{content.sending}</span>
						</>
					) : (
						content.submit
					)}
				</button>

				<p className="text-center text-xs text-muted-foreground">
					{content.privacyNote}{" "}
					<a href={content.privacyHref} className={`rounded-sm underline hover:text-foreground ${FOCUS_RING}`}>
						{content.privacyLink}
					</a>
				</p>
			</form>
		</div>
	);
}

function Quiz({
	content,
	bookingUrl,
	onRequestForm,
}: {
	content: LeadCaptureContent["quiz"];
	bookingUrl: string;
	onRequestForm: () => void;
}) {
	const [step, setStep] = useState(0);
	const [answers, setAnswers] = useState<number[]>([]);
	const headingRef = useRef<HTMLHeadingElement>(null);
	// Move focus to the new heading after a click (the clicked button is gone), not on first render.
	const interacted = useRef(false);
	const total = content.questions.length;

	useEffect(() => {
		if (interacted.current) headingRef.current?.focus();
	}, [step]);

	const go = (next: number, answer?: number) => {
		interacted.current = true;
		if (answer !== undefined) setAnswers((previous) => [...previous, answer]);
		setStep(next);
	};

	const recommendation = recommend(answers);

	const onFinish = () => {
		if (recommendation === "book_call") {
			window.open(bookingUrl, "_blank", "noopener,noreferrer");
		} else {
			onRequestForm();
		}
	};

	return (
		<div className="flex min-h-[400px] flex-col justify-center">
			{step === 0 && (
				<div
					key="start"
					className={`${ENTER_CLASS} space-y-6 text-center starting:scale-95 starting:opacity-0`}
				>
					<h3 ref={headingRef} tabIndex={-1} className={HEADING_CLASS}>
						{content.title}
					</h3>
					<p className="text-muted-foreground">{content.subtitle}</p>
					<button
						type="button"
						onClick={() => go(1)}
						className={`${BUTTON_PRIMARY} mx-auto h-10 rounded-full px-8 text-sm`}
					>
						{content.start}
					</button>
				</div>
			)}

			{step > 0 && step <= total && (
				<div
					key={`question-${step}`}
					className={`${ENTER_CLASS} space-y-8 starting:translate-x-5 starting:opacity-0`}
				>
					<div className="flex justify-between font-mono text-sm tracking-wider text-muted-foreground uppercase">
						<span>
							{content.questionPrefix} {step}
						</span>
						<span>
							{step} / {total}
						</span>
					</div>
					<h3 ref={headingRef} tabIndex={-1} className="text-xl font-medium focus:outline-none md:text-2xl">
						{content.questions[step - 1].q}
					</h3>
					<div className="grid gap-4">
						{content.questions[step - 1].options.map((option, index) => (
							<button
								key={option}
								type="button"
								onClick={() => go(step + 1, index)}
								className={`${BUTTON_OUTLINE} h-auto justify-start px-6 py-4 text-left text-sm whitespace-normal hover:text-foreground`}
							>
								{option}
							</button>
						))}
					</div>
				</div>
			)}

			{step > total && (
				<div
					key="result"
					className={`${ENTER_CLASS} space-y-6 rounded-xl border border-primary/10 bg-secondary/20 p-8 text-center starting:scale-95 starting:opacity-0`}
				>
					<div
						aria-hidden="true"
						className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary font-serif text-2xl text-primary-foreground"
					>
						!
					</div>
					<h3 ref={headingRef} tabIndex={-1} className={HEADING_CLASS}>
						{content.recommendationTitle}
					</h3>
					<p className="text-xl font-medium text-foreground">{content.results[recommendation]}</p>
					<button
						type="button"
						onClick={onFinish}
						className={`${BUTTON_PRIMARY} h-11 w-full rounded-full px-8 text-base`}
					>
						{content.results.cta}
						<ArrowRightIcon className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={() => {
							interacted.current = true;
							setAnswers([]);
							setStep(0);
						}}
						className={`${BUTTON_BASE} h-9 rounded-md px-4 text-sm text-muted-foreground hover:text-foreground`}
					>
						{content.restart}
					</button>
				</div>
			)}
		</div>
	);
}

/* Inline SVG icons (Lucide shapes); no icon package. */

function Icon({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
			className={className}
		>
			{children}
		</svg>
	);
}

function CalendarIcon({ className }: { className?: string }) {
	return (
		<Icon className={className}>
			<path d="M8 2v4" />
			<path d="M16 2v4" />
			<rect width="18" height="18" x="3" y="4" rx="2" />
			<path d="M3 10h18" />
		</Icon>
	);
}

function CheckIcon({ className }: { className?: string }) {
	return (
		<Icon className={className}>
			<path d="M20 6 9 17l-5-5" />
		</Icon>
	);
}

function ArrowRightIcon({ className }: { className?: string }) {
	return (
		<Icon className={className}>
			<path d="M5 12h14" />
			<path d="m12 5 7 7-7 7" />
		</Icon>
	);
}

function ChevronDownIcon({ className }: { className?: string }) {
	return (
		<Icon className={className}>
			<path d="m6 9 6 6 6-6" />
		</Icon>
	);
}

function SpinnerIcon({ className }: { className?: string }) {
	return (
		<Icon className={className}>
			<path d="M21 12a9 9 0 1 1-6.219-8.56" />
		</Icon>
	);
}
