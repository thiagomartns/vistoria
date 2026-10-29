using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Vistoria.Api.Configurations;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Infrastructure.OpenApi;
using Vistoria.Api.Services;

namespace Vistoria.Api.Controllers.V1;

// Delta por entidade (backend.md, "Leitura por delta"), todos no mesmo formato. Protegido pela fallback policy.
// 400: invalid-cursor ou limit fora de 1 a 1000 (validation); 410: cursor-expired.
[ApiController]
[Route("api/v1/sync")]
[ProblemResponses(
    StatusCodes.Status400BadRequest,
    StatusCodes.Status401Unauthorized,
    StatusCodes.Status410Gone)]
public class SyncController(ISyncService<ClientDto> clients, ISyncService<PropertyDto> properties)
    : ControllerBase
{
    private const string LimitMessage = "O limite precisa ser de {1} a {2}.";

    [HttpGet("clients")]
    [EndpointName("syncClients")]
    [ProducesResponseType<SyncPageDto<ClientDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<SyncPageDto<ClientDto>>> Clients(
        [FromQuery] string? cursor,
        CancellationToken cancellationToken,
        [FromQuery, Range(1, SyncConfig.MaxPageSize, ErrorMessage = LimitMessage)] int limit = SyncConfig.DefaultPageSize) =>
        Ok(await clients.PageAsync(User.GetUserId(), cursor, limit, cancellationToken));

    [HttpGet("properties")]
    [EndpointName("syncProperties")]
    [ProducesResponseType<SyncPageDto<PropertyDto>>(StatusCodes.Status200OK)]
    public async Task<ActionResult<SyncPageDto<PropertyDto>>> Properties(
        [FromQuery] string? cursor,
        CancellationToken cancellationToken,
        [FromQuery, Range(1, SyncConfig.MaxPageSize, ErrorMessage = LimitMessage)] int limit = SyncConfig.DefaultPageSize) =>
        Ok(await properties.PageAsync(User.GetUserId(), cursor, limit, cancellationToken));
}
