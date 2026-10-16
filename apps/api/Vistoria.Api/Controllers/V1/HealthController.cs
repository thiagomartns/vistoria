using Microsoft.AspNetCore.Mvc;
using Vistoria.Api.Data.DTO.V1;

namespace Vistoria.Api.Controllers.V1;

[ApiController]
[Route("api/v1/health")]
public class HealthController : ControllerBase
{
    [HttpGet]
    [EndpointName("getHealth")]
    [ProducesResponseType<HealthDto>(StatusCodes.Status200OK)]
    public ActionResult<HealthDto> Get() => Ok(new HealthDto("ok"));
}
