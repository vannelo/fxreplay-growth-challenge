# Growth Engineer — Technical Challenge (FX Replay)

> Text transcription of `Growth Engineer Challenge.pdf` for use as context in Claude sessions.
> Source of truth is the original PDF. The PDF text extraction ended mid-line on the final page
> (at "*Live deployment"), so the Submission section below may be incomplete: check the PDF.

## Overview
At FX Replay, Growth Engineering sits at the intersection of software engineering, web experience, analytics,
experimentation, infrastructure, design, and AI-native development.

For this challenge, we want to understand how you approach a realistic growth problem end-to-end.

We're not looking for framework trivia, algorithm exercises, or an unnecessarily large application. We care about your
technical judgment, autonomy, quality of execution, ability to make sensible trade-offs, and ability to use AI as
meaningful engineering leverage.

## The Challenge

### Scenario
FX Replay wants to launch a new marketing experience centered around: **Try FX Replay Free**

The business objective is to increase the conversion rate from marketing traffic to account creation.

Your task is to design and build a small but production-minded experience addressing this opportunity.

You should be able to explain not only what you built, but also why you built it that way, how you would measure
whether it worked, and how you would operate it in production.

## What to Build

### 1. Landing Experience
Create a responsive marketing landing page that includes:
- A clear value proposition
- A primary CTA
- A polished, production-quality interface
- Responsive behavior across common screen sizes
- Appropriate accessibility considerations

You have flexibility over the experience and visual direction. We intentionally don't want to prescribe every design
decision. Part of the challenge is demonstrating how you translate a business objective into an effective experience.

### 2. Signup Flow
Implement a signup or simulated signup flow. The experience should demonstrate:
- Appropriate user states
- Validation
- Error handling
- Loading/async behavior where applicable
- A successful conversion state

You do not need to recreate FX Replay's complete authentication system.

### 3. API Integration
Implement a basic Users API that supports:
- Creating a user
- Updating a user
- Listing users

The signup flow should call the Users API so the integration is a meaningful part of the experience rather than a
standalone demonstration.

The persistence approach is intentionally open. You may use in-memory storage, a file, a database, Notion, or another
reasonable option. Document your choice, rationale, and relevant trade-offs.

We're interested in how you design the API contract, structure communication between the frontend and backend, and
handle validation, failures, and asynchronous behavior.

## Analytics & Measurement
Treat analytics as part of the product, not something added after implementation.

### Event Taxonomy
Define the important events you would instrument. For each relevant event, consider:
- Event name
- Trigger
- Important properties
- User/session context where applicable

### Conversion Funnel
Define the funnel you would use to measure the experience. At minimum, identify:
- Funnel entry
- Important intermediate steps
- Primary conversion event
- Primary conversion metric

You may use GA4, GTM, PostHog, Segment, Amplitude, or another appropriate analytics architecture. You do not need
access to FX Replay's production analytics accounts.

Explain how you would ensure that the resulting analytics data is accurate and trustworthy.

## Experiment Proposal
Propose at least one A/B experiment related to your experience. Document:
- **Hypothesis:** What do you believe will improve conversion, and why?
- **Control:** What is the baseline experience?
- **Variant:** What would you change?
- **Success Metric:** What metric determines whether the experiment succeeds?
- **Decision:** What result would cause you to: ship the variant / continue the experiment / reject the variant

We care more about your reasoning and measurement methodology than the complexity of the experiment.

## Performance & Production Readiness
Treat the experience as something that could eventually receive meaningful production traffic.

### Web Performance
Consider: Core Web Vitals, loading strategy, rendering strategy, asset optimization, JavaScript execution, third-party scripts.

### SEO
Consider relevant: metadata, semantic structure, technical SEO, structured data.

### Accessibility
Explain the accessibility considerations incorporated into the experience.

### Infrastructure
Describe how you would approach: hosting, deployment, CI/CD, DNS, CDN / edge, caching, observability, security, reliability.

You don't need to build an enterprise infrastructure platform for the challenge. We want to understand how you think
about operating what you build.

## AI-Native Development
AI-native development is an important part of this role.

For this challenge, Claude Code should be a central part of your development workflow. Simply using AI for code
completion or occasionally asking it questions is not what we're evaluating. We want to understand the system you
build around AI. Your solution should demonstrate:

### Project-Level Instructions
Create appropriate project-level Claude instructions that provide useful context and constraints for the project.

### Reusable Skill or Workflow
Create at least one reusable Skill, command, or specialized workflow relevant to the challenge.

### Agents
Use one or more agents with clearly defined responsibilities. For example, agents could assist with: research,
implementation, analytics, testing, accessibility, performance, code review, experiment analysis.
You are free to determine the architecture.

### MCP
Use an MCP integration where it provides meaningful value. If an MCP integration would add unnecessary complexity to
the challenge, instead document:
- What you would connect through MCP in a production environment
- Why
- How your agents would use it

### Human Judgment
Be prepared to explain:
- What you delegated to AI
- What you intentionally did yourself
- What AI-generated outputs you rejected or corrected
- How you validated AI-generated work

We're evaluating your engineering judgment and ability to create leverage with AI, not how many prompts you generated.

## Deliverables
Please provide the following:

### 1. Working Implementation
A functional implementation of the experience. Provide: repository URL, live deployment URL (if deployed), clear local
setup instructions. The project should be straightforward for another engineer to run and review.

### 2. Architecture Overview
A short architecture document covering:
- Overall application structure
- Major technical decisions
- Important trade-offs
- API/integration approach
- Deployment architecture
- Infrastructure considerations
- What you would change if this became a production FX Replay system

A diagram is welcome but not required.

### 3. Analytics Plan
Document: events, properties, funnel, primary conversion metric, analytics architecture/tooling, data-quality considerations.

### 4. Experiment Proposal
Document: hypothesis, control, variant, success metric, decision criteria.

### 5. AI-Native Workflow
Document your Claude Code setup, including:
- Project-level instructions
- Agents
- Skills / commands / reusable workflows
- MCP integrations or proposed MCP architecture
- How the different pieces work together
- Examples of where AI improved execution
- Examples of where you corrected or rejected AI output

Please commit the relevant configuration and instruction files to the repository where practical so we can review the
system itself rather than only a description of it.

### 6. Performance Review
Provide a short assessment covering: Core Web Vitals, performance decisions, SEO, accessibility, rendering strategy,
caching / CDN strategy, important production risks.

## Scope & Expectations
This is intentionally an open-ended challenge. There is no single correct architecture, design, analytics stack, or experiment.

### Time Expectation
Please time-box your work to approximately **6 hours** and submit your completed challenge within **72 hours** of
receiving it. The 72-hour window provides flexibility for when you complete the challenge; we do not expect 72 hours of work.

Focus on what you believe provides the most value. Where you choose not to implement something, briefly document your
approach and what you would do next with additional time.

We value thoughtful prioritization and trade-offs over feature completeness. Make reasonable assumptions where
requirements are incomplete. Document those assumptions and keep moving.

### Technical Review
After submission, you'll have a 60 minute technical review with members of the FX Replay Engineering team. You'll walk
us through your solution, explain the key decisions and trade-offs you made, and discuss how you would evolve the
experience for a real production environment.

We may also introduce one additional requirement during the conversation. You won't be expected to have anticipated
it; we're interested in how you reason through change, make trade-offs, and adapt your approach.

This is a collaborative technical discussion, not a separate coding test.

## What We're Looking For
We're interested in your ability to take a growth problem and independently turn it into a high-quality, measurable,
production-minded solution. We'll look at the quality of your:
- Engineering and architecture decisions
- Analytics and experimentation approach
- AI-native development workflow
- Web performance and production thinking
- Design and user experience
- Thoughtful interpretation of FX Replay's brand within the provided typography and color palette, while evolving the
  visual direction where appropriate
- Ownership, prioritization, and technical judgment

We don't expect every area to be equally elaborate. We're particularly interested in the decisions and trade-offs you
make given the scope of the challenge, and your ability to explain why you made them.

A smaller, thoughtfully executed solution is more valuable to us than a large implementation with unnecessary complexity.

## Submission
Please send us:
- Repository URL
- Live deployment (text cut off in extraction; see original PDF)
