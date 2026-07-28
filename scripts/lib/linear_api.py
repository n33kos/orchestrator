"""Minimal Linear GraphQL client.

Runs headless from the scheduler, so it talks to the API directly rather than
through an MCP server. Authentication is a personal API key in LINEAR_API_KEY.
"""

import json
import re
import urllib.error
import urllib.request
from typing import Any

try:
    from lib import secrets
except ImportError:
    from scripts.lib import secrets


API_URL = "https://api.linear.app/graphql"
TIMEOUT = 30

_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

OPEN_STATE_TYPES = ["triage", "backlog", "unstarted", "started"]


class LinearError(RuntimeError):
    pass


def api_key() -> str:
    return secrets.get("LINEAR_API_KEY")


def query(document: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    """Execute a GraphQL document and return the `data` payload."""
    key = api_key()
    if not key:
        raise LinearError("LINEAR_API_KEY is not set")

    body = json.dumps({"query": document, "variables": variables or {}}).encode()
    request = urllib.request.Request(
        API_URL,
        data=body,
        headers={"Content-Type": "application/json", "Authorization": key},
    )

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            payload = json.loads(response.read().decode())
    except urllib.error.HTTPError as err:
        raise LinearError(f"HTTP {err.code}: {err.read().decode()[:400]}") from err
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
        raise LinearError(str(err)) from err

    if payload.get("errors"):
        messages = "; ".join(e.get("message", "?") for e in payload["errors"])
        raise LinearError(messages)
    return payload.get("data") or {}


def _entity_filter(value: str) -> dict[str, Any]:
    """Match an entity by ID when the value looks like a UUID, else by name."""
    if _UUID_RE.match(value):
        return {"id": {"eq": value}}
    return {"name": {"eqIgnoreCase": value}}


def _user_filter(value: str) -> dict[str, Any]:
    """Match a user by ID, full name, display name, or email.

    Linear exposes all three as distinct fields, and which one a person reaches for
    is unpredictable, so accept any of them.
    """
    if _UUID_RE.match(value):
        return {"id": {"eq": value}}
    return {
        "or": [
            {"name": {"eqIgnoreCase": value}},
            {"displayName": {"eqIgnoreCase": value}},
            {"email": {"eqIgnoreCase": value}},
        ]
    }


def build_issue_filter(config: dict[str, Any]) -> dict[str, Any]:
    """Translate adapter config into a Linear IssueFilter."""
    clauses: list[dict[str, Any]] = []

    team = str(config.get("team") or "").strip()
    if team:
        if _UUID_RE.match(team):
            clauses.append({"team": {"id": {"eq": team}}})
        else:
            clauses.append({"team": {"or": [{"name": {"eqIgnoreCase": team}}, {"key": {"eqIgnoreCase": team}}]}})

    assignee = str(config.get("assignee") or "").strip()
    if assignee.lower() == "me":
        clauses.append({"assignee": {"isMe": {"eq": True}}})
    elif assignee:
        clauses.append({"assignee": _user_filter(assignee)})

    # Every listed label must be present, so each one becomes its own clause.
    for label in _as_list(config.get("labels")):
        clauses.append({"labels": {"some": {"name": {"eqIgnoreCase": label}}}})

    states = _as_list(config.get("states"))
    if states:
        clauses.append({"state": {"name": {"in": states}}})
    else:
        clauses.append({"state": {"type": {"in": OPEN_STATE_TYPES}}})

    project = str(config.get("project") or "").strip()
    if project:
        clauses.append({"project": _entity_filter(project)})

    min_priority = _as_int(config.get("min_priority"))
    if min_priority:
        clauses.append({"priority": {"lte": min_priority, "gt": 0}})

    issue_filter: dict[str, Any] = {"and": clauses} if clauses else {}

    raw = config.get("raw_filter")
    if isinstance(raw, str) and raw.strip():
        try:
            issue_filter.update(json.loads(raw))
        except json.JSONDecodeError as err:
            raise LinearError(f"raw_filter is not valid JSON: {err}") from err
    elif isinstance(raw, dict) and raw:
        issue_filter.update(raw)

    return issue_filter


ISSUES_QUERY = """
query OrchestratorIssues($filter: IssueFilter, $first: Int!, $withComments: Boolean!) {
  issues(filter: $filter, first: $first, orderBy: updatedAt) {
    nodes {
      id
      identifier
      title
      description
      url
      priority
      createdAt
      updatedAt
      state { id name type }
      team { id key name }
      project { id name }
      assignee { id displayName }
      labels { nodes { name } }
      comments(first: 30) @include(if: $withComments) {
        nodes { body createdAt user { displayName } }
      }
    }
  }
}
"""


def fetch_issues(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Fetch issues matching an adapter's config."""
    variables = {
        "filter": build_issue_filter(config),
        "first": max(1, min(_as_int(config.get("limit")) or 20, 250)),
        "withComments": bool(config.get("include_comments", True)),
    }
    data = query(ISSUES_QUERY, variables)
    return (data.get("issues") or {}).get("nodes") or []


TEAM_STATES_QUERY = """
query OrchestratorTeamStates($teamId: String!) {
  team(id: $teamId) { states(first: 50) { nodes { id name type } } }
}
"""


def resolve_state_id(team_id: str, state_name: str) -> str:
    """Find a workflow state ID by name within a team."""
    data = query(TEAM_STATES_QUERY, {"teamId": team_id})
    nodes = (((data.get("team") or {}).get("states") or {}).get("nodes")) or []
    target = state_name.strip().lower()
    for node in nodes:
        if node.get("name", "").strip().lower() == target:
            return node["id"]
    raise LinearError(f"no workflow state named '{state_name}' on team {team_id}")


ISSUE_UPDATE_MUTATION = """
mutation OrchestratorIssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success }
}
"""

COMMENT_CREATE_MUTATION = """
mutation OrchestratorComment($input: CommentCreateInput!) {
  commentCreate(input: $input) { success }
}
"""

ISSUE_TEAM_QUERY = """
query OrchestratorIssueTeam($id: String!) {
  issue(id: $id) { id identifier team { id } state { id name } }
}
"""


def set_issue_state(issue_id: str, state_name: str) -> bool:
    """Move an issue to a named workflow state. Returns False when already there."""
    data = query(ISSUE_TEAM_QUERY, {"id": issue_id})
    issue = data.get("issue") or {}
    if not issue:
        raise LinearError(f"issue {issue_id} not found")
    if (issue.get("state") or {}).get("name", "").strip().lower() == state_name.strip().lower():
        return False

    state_id = resolve_state_id((issue.get("team") or {})["id"], state_name)
    result = query(ISSUE_UPDATE_MUTATION, {"id": issue_id, "input": {"stateId": state_id}})
    return bool((result.get("issueUpdate") or {}).get("success"))


def add_comment(issue_id: str, body: str) -> bool:
    result = query(COMMENT_CREATE_MUTATION, {"input": {"issueId": issue_id, "body": body}})
    return bool((result.get("commentCreate") or {}).get("success"))


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, str) and value.strip():
        return [part.strip() for part in value.split(",") if part.strip()]
    return []


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0
