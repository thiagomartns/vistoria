using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Infrastructure.OpenApi;
using Vistoria.Api.Services;
using Vistoria.Api.Sync;

namespace Vistoria.Api.Controllers.V1;

// Mesmo contrato do ClientsController, inclusive os erros do IdempotencyFilter.
[ApiController]
[Route("api/v1/properties")]
[ProblemResponses(StatusCodes.Status401Unauthorized)]
public class PropertiesController(IPropertyService properties) : ControllerBase
{
    [HttpGet("{id:guid}")]
    [EndpointName("getProperty")]
    [ProducesResponseType<PropertyDto>(StatusCodes.Status200OK)]
    [ProblemResponses(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PropertyDto>> Get(Guid id, CancellationToken cancellationToken)
    {
        var property = await properties.GetAsync(User.GetUserId(), id, cancellationToken);
        SetETag(property);
        return Ok(property);
    }

    [HttpPut("{id:guid}")]
    [EndpointName("upsertProperty")]
    [ProducesResponseType<PropertyDto>(StatusCodes.Status200OK)]
    [ProducesResponseType<PropertyDto>(StatusCodes.Status201Created)]
    [ProblemResponses(
        StatusCodes.Status400BadRequest,
        StatusCodes.Status403Forbidden,
        StatusCodes.Status409Conflict,
        StatusCodes.Status410Gone,
        StatusCodes.Status412PreconditionFailed,
        StatusCodes.Status422UnprocessableEntity,
        StatusCodes.Status428PreconditionRequired,
        StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<PropertyDto>> Upsert(
        Guid id, UpsertPropertyDto body, CancellationToken cancellationToken)
    {
        var (property, created) = await properties.UpsertAsync(
            User.GetUserId(), id, Request.Headers.IfMatch.ToString(), body, cancellationToken);
        SetETag(property);
        return created ? CreatedAtAction(nameof(Get), new { id }, property) : Ok(property);
    }

    private void SetETag(PropertyDto property) =>
        Response.Headers[HeaderNames.ETag] = ETagHelper.ToETag(property.Version);
}
