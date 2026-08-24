# Kudos System Specification

> **Status:** Approved for implementation
>
> **Approved by:** Project architect (human-in-the-loop approval)
>
> **Approval date:** 23 August 2026
>
> **Public repository:** <https://github.com/Yusosaloglu/datacom-kudos>
>
> This document began as an AI-generated draft based on the manager's original request. It was reviewed and refined before approval and implementation.

## 1. Original Request

Create a feature for our internal web app that allows users to give "kudos" to their colleagues. A user should be able to select another user from a list, write a short message of appreciation, and submit it. There should also be a public feed on the main dashboard where all recently submitted kudos are visible.

## 2. Functional Requirements

### 2.1 User Stories

1. As an employee, I want to select a colleague from a list so that I can recognise the correct person.
2. As an employee, I want to write a short message of appreciation so that I can explain why my colleague deserves recognition.
3. As an employee, I want to submit my kudos so that it is saved and shared with others.
4. As an employee, I want to view recent kudos on the main dashboard so that I can celebrate the achievements of my colleagues.
5. As an administrator, I want to hide or delete inappropriate kudos so that the public feed remains safe and professional.

### 2.2 Acceptance Criteria

#### Select a colleague

- The system displays a list of active employees.
- The current user cannot select themselves.
- A colleague must be selected before the form can be submitted.

#### Write a message

- The message is required.
- The message must contain between 3 and 500 characters after surrounding whitespace is removed.
- The interface displays the maximum message length.

#### Submit kudos

- A valid submission is saved with the sender, recipient, message and submission time.
- The user receives confirmation after a successful submission.
- Invalid submissions are not saved and produce a useful error message.
- The submit button is temporarily disabled while a submission is being processed.
- An identical sender, recipient and message combination cannot be submitted more than once within five minutes.
- A sender can submit no more than five kudos within one minute.
- Submitted kudos cannot be edited or deleted by the sender in this version of the feature.

#### View the public feed

- The feed is available to all authenticated, active employees.
- The dashboard displays recent kudos with the sender's name, recipient's name, message and submission time.
- Kudos are ordered from newest to oldest.
- The feed displays an appropriate message when no kudos exist.
- Older kudos can be loaded without displaying every record at once.

#### Moderate inappropriate kudos

- Only authenticated users with the administrator role can access moderation controls.
- An administrator can hide a visible kudos so that it no longer appears in the public feed.
- Hiding a kudos requires a reason between 3 and 200 characters.
- Hidden kudos remain available to administrators for review and auditing.
- An administrator can restore a hidden kudos after reviewing it.
- An administrator can permanently delete a kudos after confirming the destructive action.
- Deleting a kudos requires a reason between 3 and 200 characters.
- The system records who performed each moderation action and when it occurred.
- Non-administrators receive an authorization error if they attempt a moderation action.

#### Responsive and accessible interface

- The form, public feed and administrator panel remain usable on mobile, tablet and desktop screen sizes.
- Every form control has a visible label and can be operated with a keyboard.
- Keyboard focus is clearly visible.
- Success and error feedback is announced to assistive technology.

## 3. Technical Design

### 3.1 Approved Architecture

The feature consists of:

- A frontend form for creating kudos.
- A frontend feed for displaying recent kudos.
- A backend API for retrieving users, creating kudos and retrieving the feed.
- A relational database for storing users and kudos.

### 3.2 Approved Database Schema

#### `users` table

| Field | Type | Description |
|---|---|---|
| `id` | Integer | Primary key |
| `name` | Text | Employee's display name |
| `email` | Text | Unique employee email address |
| `role` | Text | Authorization role: `employee` or `admin` |
| `is_active` | Boolean | Whether the employee account is active |

#### `kudos` table

| Field | Type | Description |
|---|---|---|
| `id` | Integer | Primary key |
| `sender_id` | Integer | Foreign key referencing `users.id` |
| `recipient_id` | Integer | Foreign key referencing `users.id` |
| `message` | Text | Appreciation message, maximum 500 characters |
| `is_visible` | Boolean | Whether the kudos appears in the public feed; defaults to `true` |
| `created_at` | Timestamp | Time the kudos was submitted |
| `moderated_by` | Integer, nullable | Administrator who last moderated it; references `users.id` |
| `moderated_at` | Timestamp, nullable | Time of the most recent moderation action |
| `reason_for_moderation` | Text, nullable | Reason the kudos was hidden, maximum 200 characters |

#### `moderation_audit` table

| Field | Type | Description |
|---|---|---|
| `id` | Integer | Primary key |
| `kudos_id` | Integer | Identifier of the affected kudos, retained even after deletion |
| `action` | Text | Moderation action: `hide`, `restore` or `delete` |
| `moderator_id` | Integer | Administrator who performed the action; references `users.id` |
| `reason` | Text, nullable | Reason supplied for the action |
| `created_at` | Timestamp | Time the action occurred |

The public-feed query must include `WHERE is_visible = true`. An index on `is_visible` and `created_at` supports filtering and newest-first ordering efficiently.

### 3.3 Approved API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/users` | Return active colleagues available for selection |
| `POST` | `/api/kudos` | Validate and create a kudos message |
| `GET` | `/api/kudos` | Return recent, visible kudos in newest-first order |
| `GET` | `/api/admin/kudos?visibility=hidden` | Return hidden kudos for administrator review |
| `PATCH` | `/api/admin/kudos/:id` | Hide or restore a kudos |
| `DELETE` | `/api/admin/kudos/:id` | Permanently delete a kudos after recording an audit entry |

### 3.4 Approved Frontend Components

- **Kudos form:** colleague selector, message field, character counter and submit button.
- **Kudos feed:** a collection of recent kudos cards.
- **Kudos card:** sender, recipient, message and submission time.
- **Status message:** success, validation and server-error feedback.
- **Load more control:** retrieves the next page of older kudos.
- **Administrator moderation panel:** displays hidden kudos and provides hide, restore and delete controls to administrators only.

### 3.5 Security and Performance Considerations

- Require an authenticated employee session for all operations.
- Determine the sender from the authenticated session rather than trusting a submitted sender ID.
- Validate all inputs on the server.
- Treat messages as plain text when displayed to prevent script injection.
- Use parameterised database queries.
- Check the authenticated user's `admin` role on the server for every moderation request; hiding controls in the interface is not sufficient authorization.
- Record moderation actions in the audit table before permanently deleting a kudos.
- Reject an exact duplicate from the same sender to the same recipient within five minutes.
- Rate-limit each sender to five submission attempts per minute.
- Retrieve the feed in limited pages instead of loading every record.
- Add a database index supporting visible, newest-first feed queries.

### 3.6 Authentication and Authorization

- The feature integrates with the internal portal's authenticated session or company single sign-on (SSO).
- Unauthenticated requests receive HTTP `401 Unauthorized`.
- Authenticated employees attempting administrator operations receive HTTP `403 Forbidden`.
- The backend obtains the sender identity and role from the trusted session; the client cannot choose or override them.
- For local demonstration only, seeded employee identities may be used instead of real company accounts. This mechanism must not be used in production.

### 3.7 API Errors and Logging

- Successful creation returns HTTP `201 Created`; successful reads and moderation actions return HTTP `200 OK`.
- Validation errors return `400`, unauthenticated requests `401`, unauthorized requests `403`, missing records `404`, duplicates `409`, and rate-limit violations `429`.
- API errors use a consistent JSON structure: `{ "error": "Human-readable message" }`.
- Unexpected failures return a generic message without exposing stack traces or database details.
- The server writes structured logs containing timestamp, request method, route, status and duration.
- Logs must not contain session tokens or full kudos-message bodies.

### 3.8 Testing Strategy

- **Database tests:** verify constraints, relationships, default visibility and audit records.
- **API integration tests:** verify authentication, colleague selection, valid creation, validation failures, duplicate prevention, rate limiting and pagination.
- **Authorization tests:** prove employees cannot call administrator endpoints.
- **Moderation tests:** verify hide removes a kudos from the public feed, restore makes it visible, and deletion retains an audit entry.
- **Frontend checks:** verify empty, loading, success and error states; keyboard navigation; safe text rendering; and mobile/desktop layouts.
- Tests use an isolated temporary database and never modify production data.

### 3.9 Deployment Considerations

- Configuration such as the port and database location is supplied through environment variables rather than hard-coded production values.
- Production traffic uses HTTPS and company SSO.
- Database migrations run before deploying application code that depends on the new fields.
- Production requires backups and an approved retention policy for kudos and moderation audit records.
- A health-check endpoint allows the hosting platform to confirm that the service is running.
- Deployment documentation identifies the supported runtime version and the commands for starting and testing the application.

## 4. Approved Implementation Plan

1. **Approve the specification.** No implementation begins before this step is complete.
2. **Create the database schema and seed data.** Depends on Step 1.
3. **Implement session and authorization checks.** Depends on Step 2.
4. **Implement the colleague-list endpoint.** Depends on Step 3.
5. **Implement kudos validation and submission.** Depends on Steps 2–3.
6. **Implement the paginated public-feed endpoint.** Depends on Step 2.
7. **Implement administrator hide, restore and delete endpoints with audit logging.** Depends on Steps 2–3.
8. **Build the responsive kudos form and public feed.** Depends on Steps 4–6.
9. **Build administrator moderation controls.** Depends on Step 7.
10. **Add automated database and API tests.** Depends on Steps 3–7.
11. **Perform frontend, responsive and accessibility checks.** Depends on Steps 8–9.
12. **Document local setup and production deployment requirements.** Depends on verified Steps 10–11.

## 5. Review Decisions

1. **Hidden-record retention:** Hidden kudos and moderation audit records will be retained until Datacom defines a formal retention policy. Only an administrator can permanently delete a kudos.
2. **Sender editing and deletion:** Senders cannot edit or delete submitted kudos in this version. They can ask an administrator to moderate a mistaken submission.
3. **Duplicate submissions and spam:** The system rejects an exact duplicate sent to the same recipient within five minutes and limits each sender to five submission attempts per minute.
4. **Feed audience:** The public feed is public within the company portal, meaning it is visible to every authenticated, active employee—not to the general internet.
5. **General retention:** Kudos and audit records have no automatic expiry in this version. Production deployment requires a company-approved retention and privacy policy.

## 6. Approval Record

The project architect reviewed the functional requirements, moderation rules, database design, API contract, security controls, testing strategy, deployment considerations and implementation dependencies. The specification was formally approved on 23 August 2026. Implementation may now begin and must follow this approved blueprint.
