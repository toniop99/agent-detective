# Plan conventions

## Plan file location

Save plans inside `.agents/plans` with the current date and a semantic name based on the task description. The structure is: `.agents/plans/{plan-name}/{plan-name}-plan.md`.

Example: `.agents/plans/2026_04_20-create_new_endpoint/2026_04_20-create_new_endpoint-plan.md`.

## Sections

Every plan must contain the following sections:

- Goal.
- Context.
- Phases (each phase must be a vertical slice of the task).
  - Description (brief description of the phase).
  - To-do actions list (checkboxes list of actions to complete the phase).
- Next step.

## Goal section

- Write it short and concise. It should be 1-3 sentences that summarize the goal.

## Context section

- List the important files, folders, and code to consider.
- Link the files and folders to the actual code in the repository to make it easier for the user to review the context.
- Read the AGENTS.md file and the relevant documentation referenced in that file to understand the architecture and the coding conventions to follow while proposing the plan. Mention the specific documentation files to be considered.

## Phases section

- Each one of the phases should be a vertical slice of the task it is solving.
- Each phase must contain its description and the to-do actions list.
- Split the task into as many phases as needed to make them easier to review and merge. Do not mix multiple responsibilities in the same phase. For instance, avoid adding the required npm dependencies in the same phase as the first use case implementation.
- We must be able to commit and push the code for each phase without breaking the build. The tests must pass and the added code makes sense as its own isolated unit.
- Prioritize early feedback loops. Phase 1 should always produce something the user can see, interact with, or run. For example, when creating a new frontend page, Phase 1 should deliver a navigable page (even with incomplete or placeholder content) rather than preparing all the data/content first. This lets the user validate direction early and course-correct before investing in polish.
- Each phase must end up with the following two tasks (in this order):
  1. "Run `pnpm run lint and pnpm run typecheck` to verify the changes in terms of typechecking and linting. Fix issues if any.".
  2. "Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.".

## Next step section

- Write it short and concise. It should be a single sentence that summarizes the next step to be taken to complete the task. That is, which phase should be completed next.

## Public contracts

Types of public contracts to be considered when defining phase tasks:

- Application services and the methods signatures of each one of them.
- Domain events and the attributes of each one of them.
- Test suites and all the test cases inside each one of them.
- Database schemas and the tables inside each one of them.
- Text copies shown to end users in the UI or emails.

If there is a public contract type without any change, avoid mentioning that contract type in the plan.

## Writing style

- Always write the plan file contents in English. Even if you are having a conversation with the user in another language.