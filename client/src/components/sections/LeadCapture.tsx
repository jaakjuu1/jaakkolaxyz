import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { 
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage 
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Check, ArrowRight, Loader2, Calendar } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface LeadCaptureProps {
  content: any;
}

const formSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  company: z.string().min(2),
  message: z.string().min(10),
  budget: z.string().optional(),
});

export function LeadCapture({ content }: LeadCaptureProps) {
  const [activeTab, setActiveTab] = useState<"form" | "quiz">("form");
  const { toast } = useToast();

  return (
    <section id="lead-capture" className="py-24 bg-background border-t border-border">
      <div className="container px-4 md:px-6 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-24">
          
          {/* Header & Info */}
          <div className="space-y-8">
            <div>
              <h2 className="text-4xl md:text-5xl font-serif mb-6">{content.title}</h2>
              <p className="text-xl text-muted-foreground font-light">{content.subtitle}</p>
            </div>
            
            <div className="flex gap-4">
              <Button 
                variant={activeTab === "form" ? "default" : "outline"}
                onClick={() => setActiveTab("form")}
                className="rounded-full"
              >
                Message
              </Button>
              <Button 
                variant={activeTab === "quiz" ? "default" : "outline"}
                onClick={() => setActiveTab("quiz")}
                className="rounded-full"
              >
                Project Fit Quiz
              </Button>
            </div>

            <div className="hidden lg:block p-6 bg-secondary/30 rounded-2xl mt-12 border border-border/50">
              <div className="flex items-center gap-4 mb-4">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h4 className="font-medium">Direct Booking</h4>
                  <p className="text-sm text-muted-foreground">Skip the queue if you are ready.</p>
                </div>
              </div>
              <Button variant="link" className="px-0 text-primary underline">
                Book a 20min Discovery Call &rarr;
              </Button>
            </div>
          </div>

          {/* Interaction Area */}
          <div className="bg-card rounded-2xl shadow-xl shadow-primary/5 border border-border p-6 md:p-8">
            <AnimatePresence mode="wait">
              {activeTab === "form" ? (
                <ContactForm key="form" content={content.form} toast={toast} />
              ) : (
                <Quiz key="quiz" content={content.quiz} />
              )}
            </AnimatePresence>
          </div>

        </div>
      </div>
    </section>
  );
}

function ContactForm({ content, toast }: { content: any, toast: any }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      company: "",
      message: "",
      budget: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsSubmitting(false);
    setIsSuccess(true);
    toast({
      title: "Message sent",
      description: "Thanks for reaching out!",
    });
  }

  if (isSuccess) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center h-full min-h-[400px] text-center space-y-4"
      >
        <div className="h-20 w-20 bg-green-500/10 rounded-full flex items-center justify-center text-green-600 mb-4">
          <Check className="h-10 w-10" />
        </div>
        <h3 className="text-2xl font-serif">{content.success}</h3>
        <Button onClick={() => setIsSuccess(false)} variant="outline">
          Send another
        </Button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{content.name}</FormLabel>
                <FormControl>
                  <Input placeholder="John Doe" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{content.email}</FormLabel>
                  <FormControl>
                    <Input placeholder="john@company.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="company"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{content.company}</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Inc" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="budget"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{content.budget}</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select range" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="<2k">&lt; 2000€</SelectItem>
                    <SelectItem value="2k-5k">2000€ - 5000€</SelectItem>
                    <SelectItem value="5k-10k">5000€ - 10000€</SelectItem>
                    <SelectItem value="10k+">10000€+</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{content.message}</FormLabel>
                <FormControl>
                  <Textarea className="min-h-[120px]" placeholder="..." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="w-full h-12 text-lg" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : content.submit}
          </Button>
        </form>
      </Form>
    </motion.div>
  );
}

function Quiz({ content }: { content: any }) {
  const [step, setStep] = useState(0); // 0 = start, 1..n = questions, n+1 = result
  const [answers, setAnswers] = useState<number[]>([]);

  const handleStart = () => setStep(1);

  const handleAnswer = (optionIndex: number) => {
    const newAnswers = [...answers, optionIndex];
    setAnswers(newAnswers);
    if (step < content.questions.length) {
      setStep(step + 1);
    } else {
      setStep(content.questions.length + 1); // Go to results
    }
  };

  const getRecommendation = () => {
    // Simple logic based on answers
    // Q2: Timeline (0=ASAP, 1=1-2m, 2=6m, 3=Research)
    // Q3: Budget (0=<2k, 1=2-5k, 2=5-10k, 3=10k+)
    
    const timeline = answers[1];
    const budget = answers[2];

    if (timeline === 3 || budget === 0) return content.results.audit;
    if (timeline === 0 && budget > 1) return content.results.book_call;
    return content.results.quote;
  };

  return (
    <div className="h-full flex flex-col justify-center min-h-[400px]">
      {step === 0 && (
        <motion.div 
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="text-center space-y-6"
        >
          <h3 className="text-2xl font-serif">{content.title}</h3>
          <p className="text-muted-foreground">Let's find the best way to help you in 3 steps.</p>
          <Button size="lg" onClick={handleStart} className="rounded-full px-8">
            {content.start}
          </Button>
        </motion.div>
      )}

      {step > 0 && step <= content.questions.length && (
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="space-y-8"
        >
          <div className="flex justify-between text-sm text-muted-foreground uppercase font-mono tracking-wider">
            <span>Question {step}</span>
            <span>{step} / {content.questions.length}</span>
          </div>
          <h3 className="text-xl md:text-2xl font-medium">{content.questions[step - 1].q}</h3>
          <div className="grid gap-4">
            {content.questions[step - 1].options.map((opt: string, idx: number) => (
              <Button 
                key={idx} 
                variant="outline" 
                className="justify-start h-auto py-4 px-6 text-left whitespace-normal hover:border-primary hover:bg-secondary/50"
                onClick={() => handleAnswer(idx)}
              >
                {opt}
              </Button>
            ))}
          </div>
        </motion.div>
      )}

      {step > content.questions.length && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="text-center space-y-6 bg-secondary/20 p-8 rounded-xl border border-primary/10"
        >
          <div className="h-16 w-16 bg-primary text-primary-foreground rounded-full mx-auto flex items-center justify-center text-2xl font-serif">
            !
          </div>
          <h3 className="text-2xl font-serif">Recommendation</h3>
          <p className="text-xl font-medium text-foreground">{getRecommendation()}</p>
          <Button size="lg" className="rounded-full w-full">
            {content.results.cta} <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button variant="ghost" onClick={() => { setStep(0); setAnswers([]); }} className="text-muted-foreground">
            Restart
          </Button>
        </motion.div>
      )}
    </div>
  );
}
