# From a personal planning problem to a local tool

## Problem

Skip Budget began during an exchange semester at IE University in Madrid: comparing travel ideas against attendance requirements and a timetable that was still incomplete. Counting calendar events was insufficient because a double teaching block could represent two attendance units. A planned absence was also different from a recorded absence, and a missing record did not establish attendance.

The intended audience is IE undergraduates, particularly incoming exchange students planning travel alongside coursework. The [IE student guide](IE_STUDENT_GUIDE.md) links the researched policy and explains its limits. The public edition is free and open source because this planning workflow should not require a subscription. That is a product choice, not evidence of adoption or superiority to a paid tool.

A spreadsheet can calculate a remaining allowance. The reason to build a dedicated interface was the repeated workflow around that calculation: importing timetable updates, retaining the identity of individual units, comparing overlapping trips, and checking assessments next to the travel decision.

## Decisions embodied in the code

| Decision                                   | Reason                                                                                         | Evidence                             |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------ |
| Explicit attendance units                  | Duration and event count do not reliably represent the policy                                  | `src/domain.ts`, domain tests        |
| Keep actual, unknown, and planned separate | Avoid presenting incomplete history as a safe allowance                                        | Domain tests and the ledger          |
| Stage imports before saving                | Calendar titles and mappings require human review                                              | Import tests and browser workflow    |
| Stable source identities                   | Reimports should update records without duplicating them or silently deleting referenced units | Import regression tests              |
| Local storage with portable backups        | The public project should run without its author's provider accounts                           | Browser recovery and reload checks   |
| One active planner tab                     | Prevent stale tab overwrites without introducing distributed synchronization                   | Web Lock and browser exclusion check |

## Scope changed during development

An earlier private prototype included authentication, account approval, cloud synchronization, onboarding, and feedback. Those features served a hosted pilot but made the core planning tool harder to inspect and run independently.

The public edition deliberately keeps the calculation and import work while removing that operating burden. It trades automatic device synchronization for an explicit export/restore workflow. The private prototype and its operational records are not part of this repository's history.

The publication review also caught two concrete defects: a scenario test depended on today's date, and an impossible UTC calendar date could roll into the next month. Tests now use a supplied clock; UTC import dates are round-trip validated rather than normalized silently. Input limits and real-browser checks were added before publication.

## What has been validated

Automated checks cover arithmetic, uncertainty, overlapping trips, imported identities, malformed data, and the local save/recovery workflow. Browser checks exercise real React components and browser storage. Screenshots are generated from fictional data, not personal records. See [validation details](VALIDATION.md).

These checks establish specific behavior, not product demand. There is no published independent-user study, measured time-saving result, or evidence that the tool improves academic outcomes. It is accurate to describe the origin as a personal problem and the current evidence as functional validation.

## What remains to learn

The useful next evidence would be a small record of actual decisions: the question being answered, the previous spreadsheet/calendar method, the result from Skip Budget, whether that changed a decision, and where the workflow remained awkward. Until that evidence exists, it should not appear as a success metric in a portfolio.

AI tools assisted coding and review. The project demonstrates the choices and checks documented here; it does not claim that every line was manually authored or independently audited.
