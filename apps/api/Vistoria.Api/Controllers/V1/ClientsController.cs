using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Infrastructure.OpenApi;
using Vistoria.Api.Services;
using Vistoria.Api.Sync;

namespace Vistoria.Api.Controllers.V1;

// Protegido pela fallback policy. Os erros do PUT são os da tabela de Endpoints (backend.md), inclusive os que só
// chegam no M2 (If-Match, Idempotency-Key): o contrato não muda quando eles chegarem.
[ApiController]
[Route("api/v1/clients")]
[ProblemResponses(StatusCodes.Status401Unauthorized)]
public class ClientsController(IClientService clients) : ControllerBase
{
    [HttpGet("{id:guid}")]
    [EndpointName("getClient")]
    [ProducesResponseType<ClientDto>(StatusCodes.Status200OK)]
    [ProblemResponses(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ClientDto>> Get(Guid id, CancellationToken cancellationToken)
    {
        var client = await clients.GetAsync(User.GetUserId(), id, cancellationToken);
        SetETag(client);
        return Ok(client);
    }

    // Upsert: o id vem do cliente, então criar e atualizar são a mesma operação.
    [HttpPut("{id:guid}")]
    [EndpointName("upsertClient")]
    [ProducesResponseType<ClientDto>(StatusCodes.Status200OK)]
    [ProducesResponseType<ClientDto>(StatusCodes.Status201Created)]
    [ProblemResponses(
        StatusCodes.Status400BadRequest,
        StatusCodes.Status403Forbidden,
        StatusCodes.Status409Conflict,
        StatusCodes.Status410Gone,
        StatusCodes.Status412PreconditionFailed,
        StatusCodes.Status422UnprocessableEntity,
        StatusCodes.Status428PreconditionRequired,
        StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<ClientDto>> Upsert(
        Guid id, UpsertClientDto body, CancellationToken cancellationToken)
    {
        var (client, created) = await clients.UpsertAsync(
            User.GetUserId(), id, Request.Headers.IfMatch.ToString(), body, cancellationToken);
        SetETag(client);
        return created ? CreatedAtAction(nameof(Get), new { id }, client) : Ok(client);
    }

    private void SetETag(ClientDto client) =>
        Response.Headers[HeaderNames.ETag] = ETagHelper.ToETag(client.Version);
}
