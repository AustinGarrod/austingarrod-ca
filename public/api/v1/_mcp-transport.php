<?php

declare(strict_types=1);

require_once __DIR__.'/_mcp-write.php';
require_once __DIR__.'/_mcp-vendor/autoload.php';

use Mcp\Schema\Content\TextContent;
use Mcp\Schema\Result\CallToolResult;
use Mcp\Schema\Tool;
use Mcp\Schema\ToolAnnotations;
use Mcp\Server\ClientGateway;
use Mcp\Server\Handler\ToolHandlerInterface;
use Mcp\Server\Server;
use Mcp\Server\Transport\Http\Middleware\PassthroughMiddleware;
use Mcp\Server\Transport\StreamableHttpTransport;
use Nyholm\Psr7\Factory\Psr17Factory;
use Nyholm\Psr7Server\ServerRequestCreator;

const MCP_TOOL_BODY_LIMIT = 65536;
const MCP_WRITE_TOOLS = ['preview_change', 'apply_change'];

function mcp_change_schema(string $app): array
{
    $id = ['type' => 'string', 'minLength' => 1, 'maxLength' => 128];
    $boolean = ['type' => 'boolean'];
    $defs = ['restore_recovery' => [['id' => $id], ['id']]];
    if ($app === 'pokedex-binder') {
        $defs['set_ownership'] = [[
            'dexIds' => ['type' => 'array', 'items' => ['type' => 'integer', 'minimum' => 1], 'minItems' => 1, 'maxItems' => 50, 'uniqueItems' => true],
            'owned' => $boolean,
        ], ['dexIds', 'owned']];
    } else {
        $system = ['type' => 'string', 'enum' => ACCOUNTS_SYSTEMS];
        $name = ['type' => 'string', 'minLength' => 1, 'maxLength' => 64];
        $defs += [
            'record_observation' => [[
                'system' => $system, 'id' => $id,
                'patch' => ['type' => 'object', 'additionalProperties' => false, 'minProperties' => 1, 'properties' => [
                    'completed' => $boolean, 'claimed' => $boolean, 'discovered' => $boolean, 'built' => $boolean, 'selected' => $boolean,
                    'count' => ['type' => 'string', 'pattern' => '^(0|[1-9][0-9]{0,1023})$'],
                ]],
            ], ['system', 'id', 'patch']],
            'record_purchase' => [['id' => $id, 'choices' => ['type' => 'object', 'additionalProperties' => ['type' => 'integer', 'minimum' => 0], 'maxProperties' => 50]], ['id']],
            'remove_purchase' => [['id' => $id], ['id']],
            'activate_astral' => [['id' => $id], ['id']],
            'set_milestone' => [['id' => $id, 'owned' => $boolean], ['id', 'owned']],
            'ultra_ascension' => [[], []],
            'set_goal' => [[
                'system' => ['type' => 'string', 'enum' => ['ascension', ...ACCOUNTS_SYSTEMS]], 'id' => $id, 'enabled' => $boolean,
                'mode' => ['type' => 'string', 'enum' => ['acquire', 'activate', 'rebuild', 'mastery', 'select', 'complete']],
            ], ['system', 'id', 'enabled']],
            'set_recipe_plan' => [['id' => $id, 'quantity' => ['type' => 'string', 'pattern' => '^(0|[1-9][0-9]{0,29})$']], ['id', 'quantity']],
            'capture_checkpoint' => [['name' => $name], ['name']],
            'rename_checkpoint' => [['id' => $id, 'name' => $name], ['id', 'name']],
            'delete_checkpoint' => [['id' => $id], ['id']],
            'set_comparison' => [['ids' => ['type' => 'array', 'items' => $id, 'maxItems' => 4, 'uniqueItems' => true]], ['ids']],
        ];
    }
    $variants = [];
    foreach ($defs as $operation => [$properties, $required]) {
        $variants[] = [
            'properties' => [
                'operation' => ['const' => $operation],
                'input' => ['type' => 'object', 'additionalProperties' => false, 'properties' => (object)$properties, 'required' => $required],
            ],
        ];
    }
    return [
        'type' => 'object', 'additionalProperties' => false, 'required' => ['operation', 'input'],
        'properties' => [
            'operation' => ['type' => 'string', 'enum' => array_keys($defs)],
            'input' => ['type' => 'object'],
        ],
        'oneOf' => $variants,
    ];
}

function mcp_tools(string $app): array
{
    $query = ['query' => ['type' => 'string', 'maxLength' => 120]];
    $limit = ['limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 50]];
    $page = $limit + ['offset' => ['type' => 'integer', 'minimum' => 0, 'maximum' => 1000000]];
    $tools = [
        'list_recovery' => ['List recovery copies', 'List recovery metadata for your synced utility saves.', $page],
    ];
    if ($app === 'pokedex-binder') {
        $set = ['setId' => ['type' => 'string', 'maxLength' => 64]];
        $tools += [
            'search_catalog' => ['Search the Pokédex catalog', 'Search English physical card sets or National Dex species by name or ID.', $page + $query + $set + [
                'kind' => ['type' => 'string', 'enum' => ['species', 'sets']],
            ]],
            'list_printings' => ['List card printings', 'List English physical card printings for a National Dex ID. Optionally filter by set.', $page + $set + [
                'dexId' => ['type' => 'integer', 'minimum' => 1],
            ], ['dexId']],
            'get_collection' => ['Read synced Binder', 'Find your synced owned or missing Pokémon. Optionally filter by set and species name.', $page + $query + $set + [
                'status' => ['type' => 'string', 'enum' => ['all', 'owned', 'missing']],
            ]],
        ];
    } else {
        $filter = $page + $query + [
            'system' => ['type' => 'string', 'enum' => ['all', 'ascension', 'milestone', ...ACCOUNTS_SYSTEMS]],
        ];
        $tools += [
            'search_catalog' => ['Search the Companion catalog', 'Find entries visible on your current save, or the initial spoiler-safe catalog.', $filter],
            'get_progress' => ['Read synced progress', 'Summarize synced Companion progress and retrieve visible observations and upgrades.', $filter],
            'recommend_upgrades' => ['Recommend eligible upgrades', 'Recommend visible, eligible unowned upgrades from reviewed guide priorities or native costs.', $limit],
            'get_workspace' => ['Read goals and recipes', 'Read your visible pinned goals and recipe plans.', []],
            'get_checkpoint' => ['Inspect a checkpoint', 'Compare a named checkpoint’s currently visible Ascension purchases with your current progress.', $page + [
                'id' => ['type' => 'string', 'minLength' => 1, 'maxLength' => 128],
            ], ['id']],
            'list_checkpoints' => ['List named checkpoints', 'List your named Ascension references and their captured revisions.', []],
            'get_saved_comparison' => ['Read saved comparison', 'Show your saved visible Ascension entries and their current status.', []],
        ];
    }
    $registry = [];
    foreach ($tools as $name => $definition) {
        [$title, $description, $properties] = $definition;
        $registry[$name] = new Tool($name, $title, [
            'type' => 'object', 'properties' => (object)$properties, 'required' => $definition[3] ?? [], 'additionalProperties' => false,
        ], $description, new ToolAnnotations(title: $title, readOnlyHint: true, destructiveHint: false, openWorldHint: false));
    }
    $registry['preview_change'] = new Tool('preview_change', 'Preview a save change', mcp_change_schema($app),
        'Preview a requested change. Read and show the effects before asking for confirmation. This leaves the save untouched.',
        new ToolAnnotations(title: 'Preview a save change', readOnlyHint: true, openWorldHint: false));
    $registry['apply_change'] = new Tool('apply_change', 'Apply the confirmed change', [
        'type' => 'object', 'properties' => ['previewId' => ['type' => 'string', 'minLength' => 36, 'maxLength' => 36]],
        'required' => ['previewId'], 'additionalProperties' => false,
    ], 'Apply a reviewed preview only after the user explicitly confirms its effects. A stale preview must be reviewed again.',
        new ToolAnnotations(title: 'Apply the confirmed change', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false));
    return $registry;
}

final class UtilityMcpTool implements ToolHandlerInterface
{
    public function __construct(private Closure $run)
    {
    }

    public function execute(array $arguments, ClientGateway $gateway): CallToolResult
    {
        try {
            $value = ($this->run)($arguments);
            return new CallToolResult([new TextContent(accounts_encode($value))], structuredContent: $value);
        } catch (AccountsError $error) {
            $details = array_intersect_key($error->extra, ['choiceKey' => true, 'options' => true, 'modes' => true]);
            $value = ['code' => $error->errorCode, 'message' => $error->getMessage()] + $details;
        } catch (Throwable) {
            error_log('Utility MCP tool unavailable; request_id='.bin2hex(random_bytes(8)));
            $value = ['code' => 'service_unavailable', 'message' => 'The tool is temporarily unavailable.'];
        }
        return new CallToolResult([new TextContent(accounts_encode($value))], isError: true, structuredContent: $value);
    }
}

function mcp_call(PDO $db, array $config, array $grant, string $root, string $tool, array $args): array
{
    if (in_array($tool, MCP_WRITE_TOOLS, true) && !$grant['can_write']) {
        accounts_fail(403, 'insufficient_scope', 'Reconnect with permission to edit this utility.');
    }
    $app = $grant['app'];
    $user = $grant['user_id'];
    return match ($tool) {
        'preview_change' => mcp_preview_change($db, $config, $grant, $root, $args['operation'], (object)$args['input']),
        'apply_change' => mcp_apply_change($db, $config, $grant, $root, $args['previewId']),
        'list_recovery' => mcp_recovery_list($db, $user, $app, $args['offset'] ?? 0, $args['limit'] ?? 20),
        default => $app === 'pokedex-binder'
            ? mcp_binder_read($tool, $root, $tool === 'get_collection' ? accounts_document($db, $user, $app, 'binder') : null, $args)
            : mcp_slayer_read($db, $user, $root, $tool, $args),
    };
}

function mcp_run_transport(PDO $db, array $config, array $grant, string $root): void
{
    $factory = new Psr17Factory();
    $request = (new ServerRequestCreator($factory, $factory, $factory, $factory))->fromGlobals();
    $chatgpt = $grant['client_id'] === MCP_CHATGPT_CLIENT;
    if (!$grant['can_write'] && $request->getMethod() === 'POST') {
        // Check write scope outside JSON-RPC, before the SDK invokes a tool.
        $body = $request->getBody();
        $raw = $body->read(MCP_TOOL_BODY_LIMIT + 1);
        if (strlen($raw) > MCP_TOOL_BODY_LIMIT) {
            accounts_fail(413, 'request_too_large', 'This request exceeds the MCP tool size limit.');
        }
        $rpc = json_decode($raw, false, 64);
        if (($rpc->method ?? null) === 'tools/call' && in_array($rpc->params->name ?? null, MCP_WRITE_TOOLS, true)) {
            if ($chatgpt) {
                accounts_fail(403, 'insufficient_scope', 'ChatGPT connections have read-only access.');
            }
            mcp_challenge($config, $grant['app'], true);
        }
        $request = $request->withBody($factory->createStream($raw));
    }
    $server = Server::builder()->setServerInfo($grant['app'], '1.0.0');
    $tools = mcp_tools($grant['app']);
    if ($chatgpt) {
        $tools = array_diff_key($tools, array_fill_keys(MCP_WRITE_TOOLS, true));
    }
    foreach ($tools as $tool) {
        $server->add($tool, new UtilityMcpTool(fn(array $args) => mcp_call($db, $config, $grant, $root, $tool->name, $args)));
    }
    // The site entry point checks the canonical host and Origin for both protocol eras.
    $transport = new StreamableHttpTransport($request, $factory, $factory,
        middleware: [new PassthroughMiddleware()], maxBodyBytes: MCP_TOOL_BODY_LIMIT);
    $response = $server->build()->run($transport);
    http_response_code($response->getStatusCode());
    foreach ($response->getHeaders() as $name => $values) {
        if (in_array(strtolower($name), ['cache-control', 'access-control-allow-origin'], true)) {
            continue;
        }
        foreach ($values as $index => $value) {
            header($name.': '.$value, $index === 0);
        }
    }
    echo $response->getBody();
}
