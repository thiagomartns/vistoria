using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Vistoria.Api.Configurations;
using Vistoria.Api.Data.DTO.V1;
using Vistoria.Api.Infrastructure.OpenApi;
using Vistoria.Api.Services;

namespace Vistoria.Api.Controllers.V1;

/// <summary>
/// A consulta do endereço pelo CEP (#185). É só uma leitura de ajuda ao formulário: não passa pela outbox, não fica no
/// banco local e não é dado do usuário. O front não chama o provedor direto por causa da CSP (<c>connect-src 'self'</c>).
/// </summary>
[ApiController]
[Route("api/v1/zip-codes")]
[ProblemResponses(StatusCodes.Status401Unauthorized)]
public class ZipCodesController(IZipCodeService zipCodes) : ControllerBase
{
    [HttpGet("{zipCode}")]
    [EndpointName("getAddressByZipCode")]
    [EnableRateLimiting(RateLimitConfig.ZipCodePolicy)]
    [ProducesResponseType<ZipCodeAddressDto>(StatusCodes.Status200OK)]
    [ProblemResponses(
        StatusCodes.Status400BadRequest,
        StatusCodes.Status404NotFound,
        StatusCodes.Status429TooManyRequests,
        StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<ZipCodeAddressDto>> Get(string zipCode, CancellationToken cancellationToken) =>
        Ok(await zipCodes.FindAsync(zipCode, cancellationToken));
}
