using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Infrastructure.OpenApi;
using Vistoria.Api.Services;
using Vistoria.Api.Sync;

namespace Vistoria.Api.Controllers.V1;

// Mesmo contrato do ClientsController, inclusive os erros do IdempotencyFilter. O agregado inteiro vai e volta junto:
// ambientes e itens não têm rota própria (backend.md, "Regra do agregado").
[ApiController]
[Route("api/v1/inspections")]
[ProblemResponses(StatusCodes.Status401Unauthorized)]
public class InspectionsController(IInspectionService inspections) : ControllerBase
{
    [HttpGet("{id:guid}")]
    [EndpointName("getInspection")]
    [ProducesResponseType<InspectionDto>(StatusCodes.Status200OK)]
    [ProblemResponses(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<InspectionDto>> Get(Guid id, CancellationToken cancellationToken)
    {
        var inspection = await inspections.GetAsync(User.GetUserId(), id, cancellationToken);
        SetETag(inspection);
        return Ok(inspection);
    }

    [HttpPut("{id:guid}")]
    [EndpointName("upsertInspection")]
    [ProducesResponseType<InspectionDto>(StatusCodes.Status200OK)]
    [ProducesResponseType<InspectionDto>(StatusCodes.Status201Created)]
    [ProblemResponses(
        StatusCodes.Status400BadRequest,
        StatusCodes.Status403Forbidden,
        StatusCodes.Status409Conflict,
        StatusCodes.Status410Gone,
        StatusCodes.Status412PreconditionFailed,
        StatusCodes.Status422UnprocessableEntity,
        StatusCodes.Status428PreconditionRequired,
        StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<InspectionDto>> Upsert(
        Guid id, UpsertInspectionDto body, CancellationToken cancellationToken)
    {
        var (inspection, created) = await inspections.UpsertAsync(
            User.GetUserId(), id, Request.Headers.IfMatch.ToString(), body, cancellationToken);
        SetETag(inspection);
        return created ? CreatedAtAction(nameof(Get), new { id }, inspection) : Ok(inspection);
    }

    [HttpDelete("{id:guid}")]
    [EndpointName("deleteInspection")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProblemResponses(
        StatusCodes.Status403Forbidden,
        StatusCodes.Status409Conflict,
        StatusCodes.Status412PreconditionFailed,
        StatusCodes.Status422UnprocessableEntity,
        StatusCodes.Status428PreconditionRequired,
        StatusCodes.Status429TooManyRequests)]
    public async Task<IActionResult> Delete(Guid id, CancellationToken cancellationToken)
    {
        await inspections.DeleteAsync(User.GetUserId(), id, Request.Headers.IfMatch.ToString(), cancellationToken);
        return NoContent();
    }

    private void SetETag(InspectionDto inspection) =>
        Response.Headers[HeaderNames.ETag] = ETagHelper.ToETag(inspection.Version);
}
