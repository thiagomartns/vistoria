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
[Route("api/v1/templates")]
[ProblemResponses(StatusCodes.Status401Unauthorized)]
public class TemplatesController(ITemplateService templates) : ControllerBase
{
    [HttpGet("{id:guid}")]
    [EndpointName("getTemplate")]
    [ProducesResponseType<TemplateDto>(StatusCodes.Status200OK)]
    [ProblemResponses(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<TemplateDto>> Get(Guid id, CancellationToken cancellationToken)
    {
        var template = await templates.GetAsync(User.GetUserId(), id, cancellationToken);
        SetETag(template);
        return Ok(template);
    }

    [HttpPut("{id:guid}")]
    [EndpointName("upsertTemplate")]
    [ProducesResponseType<TemplateDto>(StatusCodes.Status200OK)]
    [ProducesResponseType<TemplateDto>(StatusCodes.Status201Created)]
    [ProblemResponses(
        StatusCodes.Status400BadRequest,
        StatusCodes.Status403Forbidden,
        StatusCodes.Status409Conflict,
        StatusCodes.Status410Gone,
        StatusCodes.Status412PreconditionFailed,
        StatusCodes.Status422UnprocessableEntity,
        StatusCodes.Status428PreconditionRequired,
        StatusCodes.Status429TooManyRequests)]
    public async Task<ActionResult<TemplateDto>> Upsert(
        Guid id, UpsertTemplateDto body, CancellationToken cancellationToken)
    {
        var (template, created) = await templates.UpsertAsync(
            User.GetUserId(), id, Request.Headers.IfMatch.ToString(), body, cancellationToken);
        SetETag(template);
        return created ? CreatedAtAction(nameof(Get), new { id }, template) : Ok(template);
    }

    private void SetETag(TemplateDto template) =>
        Response.Headers[HeaderNames.ETag] = ETagHelper.ToETag(template.Version);
}
